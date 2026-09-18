import { PartMeasurementSheetService } from '../part-measurement/part-measurement-sheet.service.js';
import { prisma } from '../../lib/prisma.js';
import { ApiError } from '../../lib/errors.js';
import { fetchSelfInspectionSessionDetailsByScheduleRowIds } from '../part-measurement/self-inspection-machine-board.repository.js';
import { DataSourceFactory } from '../visualization/data-sources/data-source-factory.js';
import { initializeVisualizationModules } from '../visualization/initialize.js';
import { getWorkInstructionServices } from '../work-instructions/work-instruction-service.factory.js';
import { parseSignageA2uiProposal, valueAtPath, type SignageA2uiProposal, type SignageA2uiSource } from './signage-a2ui.js';

/** The same read boundary supplies the approval preview and every scheduled frame. */
export class SignageA2uiDataService {
  constructor(private readonly db = prisma) {}

  async listSources() {
    const [dashboards, sessions, sheets] = await Promise.all([
      this.db.visualizationDashboard.findMany({
        where: { enabled: true }, orderBy: { name: 'asc' }, take: 100,
        select: { id: true, name: true, dataSourceType: true },
      }),
      this.db.selfInspectionSession.findMany({
        where: { invalidatedAt: null, scheduleRowId: { not: null } },
        orderBy: { updatedAt: 'desc' }, take: 100,
        select: { scheduleRowId: true, fseiban: true, fhincd: true, fhinmei: true },
      }),
      this.db.partMeasurementSheet.findMany({
        where: { status: { in: ['DRAFT', 'FINALIZED'] }, invalidatedAt: null }, orderBy: { updatedAt: 'desc' }, take: 100,
        select: { id: true, fseiban: true, fhincd: true, fhinmei: true, status: true },
      }),
    ]);
    return {
      visualizations: dashboards.map((row) => ({ ...row, source: { kind: 'visualization', id: row.id } })),
      measurementSheets: sheets.map((row) => ({ ...row, source: { kind: 'part_measurement', id: row.id } })),
      measurements: sessions.map((row) => ({ ...row, source: { kind: 'self_inspection', id: row.scheduleRowId } })),
      workInstructions: 'Use business_hermes_search with kind work_instruction; source uses its partNumber and shootingTarget. Only current PUBLIC steps and ACTIVE photos are readable.',
    };
  }

  async readSource(source: SignageA2uiSource, includeImageBytes = false): Promise<Record<string, unknown>> {
    if (source.kind === 'visualization') {
      const dashboard = await this.db.visualizationDashboard.findFirst({ where: { id: source.id, enabled: true } });
      if (!dashboard) throw new Error('表示元のダッシュボードが見つかりません');
      initializeVisualizationModules();
      const data = await DataSourceFactory.create(dashboard.dataSourceType).fetchData({
        ...(dashboard.dataSourceConfig as Record<string, unknown>),
        ...(dashboard.dataSourceType === 'production_schedule' ? { refresh: true } : {}),
      });
      if (data.metadata?.error) throw new Error('業務データを取得できません');
      return { ...data, ...(data.kind === 'series' ? {
        series: data.datasets.map((set) => ({ label: set.label, points: data.labels.map((label, index) => ({ label, value: set.values[index] })) })),
      } : {}) };
    }
    if (source.kind === 'part_measurement') {
      const sheet = await new PartMeasurementSheetService().getById(source.id);
      if (sheet.invalidatedAt || !['DRAFT', 'FINALIZED'].includes(sheet.status)) throw new Error('表示元の測定記録は無効です');
      return JSON.parse(JSON.stringify({
        status: sheet.status, fseiban: sheet.fseiban, fhincd: sheet.fhincd, fhinmei: sheet.fhinmei,
        results: [...sheet.results].sort((a, b) => a.pieceIndex - b.pieceIndex || a.templateItemId.localeCompare(b.templateItemId)), items: sheet.template?.items ?? [],
      })) as Record<string, unknown>;
    }
    if (source.kind === 'self_inspection') {
      const data = (await fetchSelfInspectionSessionDetailsByScheduleRowIds([source.id])).get(source.id);
      if (!data) throw new Error('表示元の自主検査が見つかりません');
      // Prisma decimals and dates become ordinary JSON values for A2UI selectors.
      return JSON.parse(JSON.stringify(data)) as Record<string, unknown>;
    }
    const reader = getWorkInstructionServices().read;
    const group = await reader.readPublishedGroup({ partNumber: source.partNumber, shootingTarget: source.shootingTarget });
    if (!group) throw new Error('公開済み要領書が見つかりません');
    const steps = await Promise.all(group.rows.flatMap((row) => row.steps).map(async (step) => {
      let imageUrl: string | null = null;
      if (step.imageAssetId) {
        if (includeImageBytes) {
          const result = await reader.readAsset(step.imageAssetId);
          if (!result || !['image/jpeg', 'image/png', 'image/webp'].includes(result.asset.mimeType)) {
            throw new Error('公開写真を取得できません');
          }
          imageUrl = `data:${result.asset.mimeType};base64,${result.bytes.toString('base64')}`;
        } else {
          imageUrl = `/api/work-instructions/assets/${step.imageAssetId}`;
        }
      }
      return { id: step.id, step: step.step, text: step.memoOverride ?? step.text, imageUrl };
    }));
    return { partNumber: group.partNumber, shootingTarget: group.shootingTarget, steps };
  }

  async resolve(proposal: SignageA2uiProposal): Promise<SignageA2uiProposal> {
    if (!parseSignageA2uiProposal(proposal)) throw new Error('表示定義が不正です');
    const resolved = structuredClone(proposal);
    const model = (resolved.dataMessage as { updateDataModel: { value: Record<string, unknown> } }).updateDataModel.value;
    const sources = new Map<string, Record<string, unknown>>();
    for (const binding of proposal.bindings ?? []) {
      const key = JSON.stringify(binding.source);
      let data = sources.get(key);
      if (!data) {
        data = await this.readSource(binding.source, true);
        sources.set(key, data);
      }
      const selected = valueAtPath(data, binding.select);
      if (selected === undefined || selected === null) throw new ApiError(400,
        `表示する業務データが未取得です: source=${JSON.stringify(binding.source)}, select=${binding.select}. business_hermes_read_signage_source でこのsourceを読み、実際の項目を指定してください。`,
        undefined, 'SIGNAGE_BINDING_MISSING');
      let value: unknown;
      if (binding.format === 'image') {
        if (typeof selected !== 'string' || !/^data:image\/(jpeg|png|webp);base64,/u.test(selected)) throw new Error('公開写真の参照が不正です');
        value = selected;
      } else if (binding.format === 'series') {
        if (!Array.isArray(selected)) throw new Error('グラフの参照先が配列ではありません');
        value = selected.slice(0, 24).map((point) => {
          const label = point?.[binding.labelField ?? 'label'];
          const rawValue = point?.[binding.valueField ?? 'value'];
          if ((typeof label !== 'string' && typeof label !== 'number') ||
              !['string', 'number'].includes(typeof rawValue) || String(rawValue).trim() === '' || !Number.isFinite(Number(rawValue))) {
            throw new Error('グラフの値が不正です');
          }
          return { label: String(label).slice(0, 80), value: Number(rawValue) };
        });
      } else {
        if (!['string', 'number', 'boolean'].includes(typeof selected)) throw new Error('文字の参照先には単一の値を指定してください');
        value = String(selected).slice(0, 2000);
      }
      const parts = binding.path.slice(1).split('/');
      let target = model;
      for (const part of parts.slice(0, -1)) {
        if (!target[part] || typeof target[part] !== 'object' || Array.isArray(target[part])) target[part] = {};
        target = target[part] as Record<string, unknown>;
      }
      target[parts.at(-1)!] = value;
    }
    return resolved;
  }
}
