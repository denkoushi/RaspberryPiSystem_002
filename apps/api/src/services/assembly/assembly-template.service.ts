import { randomUUID } from 'node:crypto';
import type { AssemblyTorqueTraceabilityMode } from '@raspi-system/shared-types';
import type { Prisma } from '@prisma/client';
import { ApiError } from '../../lib/errors.js';
import { prisma } from '../../lib/prisma.js';
import { TorqueUnitConverter, normalizeFastenerText } from '../torque-wrenches/index.js';
import {
  assertMarkerPageRefValid,
  loadAssemblyPageRefContext,
  normalizeMarkerPageRef,
  type AssemblyMarkerPageRefInput
} from './assembly-check-summary.js';
import { runAssemblyTransaction } from './assembly-transaction.js';

const procedureDocumentInclude = {
  pages: {
    orderBy: { pageIndex: 'asc' as const }
  }
} satisfies Prisma.AssemblyProcedureDocumentInclude;

export const assemblyTemplateDetailInclude = {
  procedureDocument: {
    include: procedureDocumentInclude
  },
  checkItems: {
    orderBy: { sortOrder: 'asc' }
  },
  areas: {
    orderBy: { sortOrder: 'asc' },
    include: {
      bolts: {
        orderBy: { sortOrder: 'asc' }
      }
    }
  }
} satisfies Prisma.AssemblyTemplateInclude;

export type AssemblyTemplateDetailRow = Prisma.AssemblyTemplateGetPayload<{
  include: typeof assemblyTemplateDetailInclude;
}>;

export type AssemblyTemplateDetail = Omit<AssemblyTemplateDetailRow, 'traceabilityMode'> & {
  traceabilityMode: AssemblyTorqueTraceabilityMode;
};

/** Existing rows have NULL because the production migration is expand-only. */
export function resolveAssemblyTraceabilityMode(
  value: string | null | undefined
): AssemblyTorqueTraceabilityMode {
  if (value == null || value === 'LEGACY') return 'LEGACY';
  if (value === 'REQUIRED') return 'REQUIRED';
  throw new ApiError(500, '組立テンプレートのトレーサビリティ設定が不正です');
}

export function resolveAssemblyTemplateDetail(
  template: AssemblyTemplateDetailRow
): AssemblyTemplateDetail {
  return {
    ...template,
    traceabilityMode: resolveAssemblyTraceabilityMode(template.traceabilityMode)
  };
}

export type AssemblyTemplateSummary = {
  id: string;
  modelCode: string;
  procedurePattern: string;
  name: string;
  version: number;
  isActive: boolean;
  traceabilityMode: AssemblyTorqueTraceabilityMode;
  procedureDocumentId: string;
  procedureDocumentName: string;
  areaCount: number;
  boltCount: number;
  createdAt: Date;
  updatedAt: Date;
};

export type AssemblyTemplateBoltInput = {
  sortOrder: number;
  tighteningId?: string;
  markerNo: number;
  xRatio: number;
  yRatio: number;
  calloutTipXRatio?: number | null;
  calloutTipYRatio?: number | null;
  boltSpec: string;
  nominalDiameter?: string | null;
  boltLengthMm?: number | null;
  material?: string | null;
  strengthClass?: string | null;
  capabilityGroupId?: string | null;
  nominalTorque: number;
  lowerLimit: number;
  upperLimit: number;
  unit: string;
  kioskDocumentId?: string | null;
  assemblyProcedureDocumentId?: string | null;
  pageIndex?: number | null;
};

export type AssemblyTemplateCheckItemInput = {
  markerNo: number;
  label?: string | null;
  required?: boolean;
  xRatio: number;
  yRatio: number;
  calloutTipXRatio?: number | null;
  calloutTipYRatio?: number | null;
  sortOrder: number;
  kioskDocumentId?: string | null;
  assemblyProcedureDocumentId?: string | null;
  pageIndex?: number;
};

export type AssemblyTemplateAreaInput = {
  sortOrder: number;
  processNo: string;
  areaCode: string;
  areaName: string;
  unitCode: string;
  requireManualAdvance?: boolean;
  bolts: AssemblyTemplateBoltInput[];
};

export type AssemblyTemplateUpsertInput = {
  modelCode: string;
  procedurePattern: string;
  name: string;
  procedureDocumentId: string;
  areas: AssemblyTemplateAreaInput[];
  checkItems?: AssemblyTemplateCheckItemInput[];
  traceabilityMode?: AssemblyTorqueTraceabilityMode;
};

function normalizeKey(value: string, fieldName: string): string {
  const trimmed = value.trim();
  if (!trimmed) throw new ApiError(400, `${fieldName}が必要です`);
  return trimmed;
}

function clampRatio(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

function normalizeCalloutTip(
  xRatio: number | null | undefined,
  yRatio: number | null | undefined
): { calloutTipXRatio: number | null; calloutTipYRatio: number | null } {
  const bothOmitted = xRatio === undefined && yRatio === undefined;
  const bothNull = xRatio === null && yRatio === null;
  if (bothOmitted || bothNull) {
    return { calloutTipXRatio: null, calloutTipYRatio: null };
  }
  if (typeof xRatio !== 'number' || typeof yRatio !== 'number') {
    throw new ApiError(400, '矢視先端座標はX/Yを両方指定してください');
  }
  if (!Number.isFinite(xRatio) || !Number.isFinite(yRatio) || xRatio < 0 || xRatio > 1 || yRatio < 0 || yRatio > 1) {
    throw new ApiError(400, '矢視先端座標は0から1の範囲で指定してください');
  }
  return { calloutTipXRatio: xRatio, calloutTipYRatio: yRatio };
}

function normalizeCheckItems(checkItems: AssemblyTemplateCheckItemInput[]): AssemblyTemplateCheckItemInput[] {
  const markerNos = new Set<number>();
  const sortOrders = new Set<number>();
  return [...checkItems]
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .map((item, index) => {
      const markerNo = Math.max(1, Math.trunc(item.markerNo));
      const sortOrder = index;
      if (markerNos.has(markerNo)) {
        throw new ApiError(400, `チェック項目 markerNo ${markerNo} が重複しています`);
      }
      if (sortOrders.has(sortOrder)) {
        throw new ApiError(400, `チェック項目 sortOrder ${sortOrder} が重複しています`);
      }
      markerNos.add(markerNo);
      sortOrders.add(sortOrder);
      const calloutTip = normalizeCalloutTip(item.calloutTipXRatio, item.calloutTipYRatio);
      return {
        ...item,
        ...calloutTip,
        markerNo,
        sortOrder,
        label: item.label?.trim() || null,
        required: item.required ?? true,
        xRatio: clampRatio(item.xRatio),
        yRatio: clampRatio(item.yRatio)
      };
    });
}

function generatedTighteningId(markerNo: number): string {
  return `TIGHTENING-${markerNo}-${randomUUID()}`;
}

function normalizeOptionalFastener(value: string | null | undefined): string | null {
  return value == null || value.trim() === '' ? null : normalizeFastenerText(value);
}

function normalizeAreas(
  areas: AssemblyTemplateAreaInput[],
  traceabilityMode: AssemblyTorqueTraceabilityMode
): AssemblyTemplateAreaInput[] {
  if (areas.length === 0) {
    throw new ApiError(400, '工程エリアが1件以上必要です');
  }
  const templateMarkerNos = new Set<number>();
  return [...areas]
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .map((area, areaIndex) => {
      if (area.bolts.length === 0) {
        throw new ApiError(400, `工程${area.processNo || areaIndex + 1}に締付箇所が必要です`);
      }
      return {
        ...area,
        sortOrder: areaIndex,
        processNo: normalizeKey(area.processNo, '工程No.').slice(0, 80),
        areaCode: normalizeKey(area.areaCode, 'エリアコード').slice(0, 80),
        areaName: normalizeKey(area.areaName, 'エリア名').slice(0, 200),
        unitCode: normalizeKey(area.unitCode, 'ユニットコード').slice(0, 80),
        bolts: [...area.bolts]
          .sort((a, b) => a.sortOrder - b.sortOrder)
          .map((bolt, boltIndex) => {
            if (bolt.lowerLimit > bolt.nominalTorque || bolt.nominalTorque > bolt.upperLimit) {
              throw new ApiError(400, `丸数字${bolt.markerNo || boltIndex + 1}: 下限値 ≤ 規定値 ≤ 上限値にしてください`);
            }
            const markerNo = Math.max(1, Math.trunc(bolt.markerNo));
            if (templateMarkerNos.has(markerNo)) {
              throw new ApiError(400, `丸数字${markerNo}がテンプレート内で重複しています`);
            }
            templateMarkerNos.add(markerNo);
            const calloutTip = normalizeCalloutTip(bolt.calloutTipXRatio, bolt.calloutTipYRatio);
            const nominalDiameter = normalizeOptionalFastener(bolt.nominalDiameter);
            const material = normalizeOptionalFastener(bolt.material);
            const strengthClass = normalizeOptionalFastener(bolt.strengthClass);
            const capabilityGroupId = bolt.capabilityGroupId?.trim() || null;
            const boltLengthMm = bolt.boltLengthMm == null ? null : Number(bolt.boltLengthMm);
            if (
              traceabilityMode === 'REQUIRED' &&
              (!nominalDiameter || !Number.isFinite(boltLengthMm) || boltLengthMm! <= 0 || !material || !strengthClass || !capabilityGroupId)
            ) {
              throw new ApiError(400, `丸数字${markerNo}: 呼び径、長さ、材質、強度区分、適合グループが必要です`);
            }
            if (traceabilityMode === 'REQUIRED') {
              TorqueUnitConverter.canonicalUnit(bolt.unit);
            }
            return {
              ...bolt,
              ...calloutTip,
              sortOrder: boltIndex,
              tighteningId:
                traceabilityMode === 'LEGACY' && bolt.tighteningId
                  ? normalizeKey(bolt.tighteningId, '締付ID').slice(0, 120)
                  : generatedTighteningId(markerNo).slice(0, 120),
              markerNo,
              xRatio: clampRatio(bolt.xRatio),
              yRatio: clampRatio(bolt.yRatio),
              boltSpec: normalizeKey(bolt.boltSpec, 'ボルト仕様').slice(0, 200),
              nominalDiameter,
              boltLengthMm,
              material,
              strengthClass,
              capabilityGroupId,
              unit: normalizeKey(bolt.unit, '単位').slice(0, 40)
            };
          })
      };
    });
}

async function validateRequiredCapabilityGroups(
  tx: Prisma.TransactionClient,
  areas: AssemblyTemplateAreaInput[],
  traceabilityMode: AssemblyTorqueTraceabilityMode
): Promise<void> {
  if (traceabilityMode !== 'REQUIRED') return;
  const ids = [...new Set(areas.flatMap((area) => area.bolts.map((bolt) => bolt.capabilityGroupId!)))];
  const groups = await tx.torqueWrenchCapabilityGroup.findMany({ where: { id: { in: ids }, isActive: true } });
  const byId = new Map(groups.map((group) => [group.id, group]));
  for (const bolt of areas.flatMap((area) => area.bolts)) {
    const group = byId.get(bolt.capabilityGroupId!);
    const matches =
      group &&
      group.nominalDiameter === bolt.nominalDiameter &&
      group.boltLengthMm.equals(bolt.boltLengthMm!) &&
      group.material === bolt.material &&
      group.strengthClass === bolt.strengthClass;
    if (!matches) {
      throw new ApiError(400, `丸数字${bolt.markerNo}: 締結条件と適合グループが一致しません`);
    }
  }
}

function collectMarkerRefs(input: {
  areas: AssemblyTemplateAreaInput[];
  checkItems: AssemblyTemplateCheckItemInput[];
}): AssemblyMarkerPageRefInput[] {
  return [
    ...input.areas.flatMap((area) =>
      area.bolts.map((bolt) => ({
        kioskDocumentId: bolt.kioskDocumentId,
        assemblyProcedureDocumentId: bolt.assemblyProcedureDocumentId,
        pageIndex: bolt.pageIndex
      }))
    ),
    ...input.checkItems.map((item) => ({
      kioskDocumentId: item.kioskDocumentId,
      assemblyProcedureDocumentId: item.assemblyProcedureDocumentId,
      pageIndex: item.pageIndex
    }))
  ];
}

async function validateTemplateMarkerRefs(
  tx: Prisma.TransactionClient,
  input: { areas: AssemblyTemplateAreaInput[]; checkItems: AssemblyTemplateCheckItemInput[] }
): Promise<void> {
  const context = await loadAssemblyPageRefContext(tx, collectMarkerRefs(input));
  for (const area of input.areas) {
    for (const bolt of area.bolts) {
      assertMarkerPageRefValid(
        {
          kioskDocumentId: bolt.kioskDocumentId,
          assemblyProcedureDocumentId: bolt.assemblyProcedureDocumentId,
          pageIndex: bolt.pageIndex
        },
        context,
        bolt.tighteningId ?? `丸数字${bolt.markerNo}`,
        { allowOmitted: true }
      );
    }
  }
  for (const item of input.checkItems) {
    assertMarkerPageRefValid(
      {
        kioskDocumentId: item.kioskDocumentId,
        assemblyProcedureDocumentId: item.assemblyProcedureDocumentId,
        pageIndex: item.pageIndex
      },
      context,
      `チェック項目 ${item.markerNo}`,
      { allowOmitted: false }
    );
  }
}

export class AssemblyTemplateService {
  async list(params: {
    includeInactive?: boolean;
    modelCode?: string;
    procedurePattern?: string;
    q?: string;
    limit?: number;
  }): Promise<AssemblyTemplateDetail[]> {
    const modelCode = params.modelCode?.trim();
    const procedurePattern = params.procedurePattern?.trim();
    const q = params.q?.trim();
    const templates = await prisma.assemblyTemplate.findMany({
      where: {
        ...(params.includeInactive ? {} : { isActive: true }),
        ...(modelCode ? { modelCode: { equals: modelCode, mode: 'insensitive' } } : {}),
        ...(procedurePattern ? { procedurePattern: { equals: procedurePattern, mode: 'insensitive' } } : {}),
        ...(q
          ? {
              OR: [
                { modelCode: { contains: q, mode: 'insensitive' } },
                { procedurePattern: { contains: q, mode: 'insensitive' } },
                { name: { contains: q, mode: 'insensitive' } }
              ]
            }
          : {})
      },
      include: assemblyTemplateDetailInclude,
      orderBy: [{ updatedAt: 'desc' }, { modelCode: 'asc' }, { procedurePattern: 'asc' }],
      take: Math.min(Math.max(params.limit ?? 100, 1), 200)
    });
    return templates.map(resolveAssemblyTemplateDetail);
  }

  async listSummary(params: {
    includeInactive?: boolean;
    modelCode?: string;
    procedurePattern?: string;
    procedureDocumentId?: string;
    procedureDocumentName?: string;
    q?: string;
    limit?: number;
  }): Promise<AssemblyTemplateSummary[]> {
    const modelCode = params.modelCode?.trim();
    const procedurePattern = params.procedurePattern?.trim();
    const procedureDocumentName = params.procedureDocumentName?.trim();
    const q = params.q?.trim();
    const templates = await prisma.assemblyTemplate.findMany({
      where: {
        ...(params.includeInactive ? {} : { isActive: true }),
        ...(modelCode ? { modelCode: { equals: modelCode, mode: 'insensitive' } } : {}),
        ...(procedurePattern ? { procedurePattern: { equals: procedurePattern, mode: 'insensitive' } } : {}),
        ...(params.procedureDocumentId ? { procedureDocumentId: params.procedureDocumentId } : {}),
        ...(procedureDocumentName
          ? {
              procedureDocument: {
                name: { contains: procedureDocumentName, mode: 'insensitive' }
              }
            }
          : {}),
        ...(q
          ? {
              OR: [
                { modelCode: { contains: q, mode: 'insensitive' } },
                { procedurePattern: { contains: q, mode: 'insensitive' } },
                { name: { contains: q, mode: 'insensitive' } },
                { procedureDocument: { name: { contains: q, mode: 'insensitive' } } }
              ]
            }
          : {})
      },
      select: {
        id: true,
        modelCode: true,
        procedurePattern: true,
        name: true,
        version: true,
        isActive: true,
        traceabilityMode: true,
        procedureDocumentId: true,
        createdAt: true,
        updatedAt: true,
        procedureDocument: {
          select: {
            name: true
          }
        },
        areas: {
          select: {
            id: true,
            _count: {
              select: { bolts: true }
            }
          }
        }
      },
      orderBy: [{ updatedAt: 'desc' }, { modelCode: 'asc' }, { procedurePattern: 'asc' }, { version: 'desc' }],
      take: Math.min(Math.max(params.limit ?? 100, 1), 200)
    });

    return templates.map((template) => ({
      id: template.id,
      modelCode: template.modelCode,
      procedurePattern: template.procedurePattern,
      name: template.name,
      version: template.version,
      isActive: template.isActive,
      traceabilityMode: resolveAssemblyTraceabilityMode(template.traceabilityMode),
      procedureDocumentId: template.procedureDocumentId,
      procedureDocumentName: template.procedureDocument.name,
      areaCount: template.areas.length,
      boltCount: template.areas.reduce((sum, area) => sum + area._count.bolts, 0),
      createdAt: template.createdAt,
      updatedAt: template.updatedAt
    }));
  }

  async getById(id: string, options: { includeInactive?: boolean } = {}): Promise<AssemblyTemplateDetail | null> {
    const template = await prisma.assemblyTemplate.findFirst({
      where: {
        id,
        ...(options.includeInactive ? {} : { isActive: true })
      },
      include: assemblyTemplateDetailInclude
    });
    return template ? resolveAssemblyTemplateDetail(template) : null;
  }

  async create(input: AssemblyTemplateUpsertInput): Promise<AssemblyTemplateDetail> {
    const modelCode = normalizeKey(input.modelCode, '型番/FHINCD').slice(0, 120);
    const procedurePattern = normalizeKey(input.procedurePattern, '手順パターン').slice(0, 120);
    const name = normalizeKey(input.name, 'テンプレート名').slice(0, 200);
    const traceabilityMode = input.traceabilityMode ?? 'LEGACY';
    const areas = normalizeAreas(input.areas, traceabilityMode);
    const checkItems = normalizeCheckItems(input.checkItems ?? []);

    return runAssemblyTransaction(async (tx) => {
      const doc = await tx.assemblyProcedureDocument.findFirst({
        where: { id: input.procedureDocumentId, isActive: true, status: 'PUBLISHED' }
      });
      if (!doc) throw new ApiError(400, '公開済みで有効な手順書を指定してください');

      await validateTemplateMarkerRefs(tx, { areas, checkItems });
      await validateRequiredCapabilityGroups(tx, areas, traceabilityMode);

      const versionAgg = await tx.assemblyTemplate.aggregate({
        where: { modelCode, procedurePattern },
        _max: { version: true }
      });
      const version = (versionAgg._max.version ?? 0) + 1;
      await tx.assemblyTemplate.updateMany({
        where: { modelCode, procedurePattern, isActive: true },
        data: { isActive: false }
      });
      const created = await tx.assemblyTemplate.create({
        data: {
          modelCode,
          procedurePattern,
          name,
          version,
          procedureDocumentId: doc.id,
          traceabilityMode,
          checkItems: {
            create: checkItems.map((item) => {
              const pageRef = normalizeMarkerPageRef(
                {
                  kioskDocumentId: item.kioskDocumentId,
                  assemblyProcedureDocumentId: item.assemblyProcedureDocumentId,
                  pageIndex: item.pageIndex
                },
                { allowOmitted: false }
              );
              return {
                markerNo: item.markerNo,
                label: item.label,
                required: item.required ?? true,
                xRatio: item.xRatio,
                yRatio: item.yRatio,
                calloutTipXRatio: item.calloutTipXRatio,
                calloutTipYRatio: item.calloutTipYRatio,
                sortOrder: item.sortOrder,
                kioskDocumentId: pageRef.kioskDocumentId,
                assemblyProcedureDocumentId: pageRef.assemblyProcedureDocumentId,
                pageIndex: pageRef.pageIndex ?? 0
              };
            })
          }
        }
      });
      for (const area of areas) {
        const createdArea = await tx.assemblyTemplateArea.create({
          data: {
            templateId: created.id,
            sortOrder: area.sortOrder,
            processNo: area.processNo,
            areaCode: area.areaCode,
            areaName: area.areaName,
            unitCode: area.unitCode,
            requireManualAdvance: area.requireManualAdvance ?? true
          }
        });
        await tx.assemblyTemplateBolt.createMany({
          data: area.bolts.map((bolt) => {
            const pageRef = normalizeMarkerPageRef(
              {
                kioskDocumentId: bolt.kioskDocumentId,
                assemblyProcedureDocumentId: bolt.assemblyProcedureDocumentId,
                pageIndex: bolt.pageIndex
              },
              { allowOmitted: true }
            );
            return {
              areaId: createdArea.id,
              templateId: created.id,
              sortOrder: bolt.sortOrder,
              tighteningId: bolt.tighteningId!,
              markerNo: bolt.markerNo,
              xRatio: bolt.xRatio,
              yRatio: bolt.yRatio,
              calloutTipXRatio: bolt.calloutTipXRatio,
              calloutTipYRatio: bolt.calloutTipYRatio,
              boltSpec: bolt.boltSpec,
              nominalDiameter: bolt.nominalDiameter,
              boltLengthMm: bolt.boltLengthMm,
              material: bolt.material,
              strengthClass: bolt.strengthClass,
              capabilityGroupId: bolt.capabilityGroupId,
              nominalTorque: bolt.nominalTorque,
              lowerLimit: bolt.lowerLimit,
              upperLimit: bolt.upperLimit,
              unit: bolt.unit,
              kioskDocumentId: pageRef.kioskDocumentId,
              assemblyProcedureDocumentId: pageRef.assemblyProcedureDocumentId,
              pageIndex: pageRef.pageIndex
            };
          })
        });
      }
      const detail = await tx.assemblyTemplate.findUnique({
        where: { id: created.id },
        include: assemblyTemplateDetailInclude
      });
      if (!detail) throw new ApiError(500, '作成したテンプレートを取得できませんでした');
      return resolveAssemblyTemplateDetail(detail);
    });
  }

  async revise(id: string, input: Partial<AssemblyTemplateUpsertInput>): Promise<AssemblyTemplateDetail> {
    const source = await this.getById(id, { includeInactive: true });
    if (!source) throw new ApiError(404, 'テンプレートが見つかりません');
    const areas =
      input.areas ??
      source.areas.map((area) => ({
        sortOrder: area.sortOrder,
        processNo: area.processNo,
        areaCode: area.areaCode,
        areaName: area.areaName,
        unitCode: area.unitCode,
        requireManualAdvance: area.requireManualAdvance,
        bolts: area.bolts.map((bolt) => ({
          sortOrder: bolt.sortOrder,
          tighteningId: bolt.tighteningId,
          markerNo: bolt.markerNo,
          xRatio: Number(bolt.xRatio),
          yRatio: Number(bolt.yRatio),
          calloutTipXRatio: bolt.calloutTipXRatio == null ? null : Number(bolt.calloutTipXRatio),
          calloutTipYRatio: bolt.calloutTipYRatio == null ? null : Number(bolt.calloutTipYRatio),
          boltSpec: bolt.boltSpec,
          nominalDiameter: bolt.nominalDiameter,
          boltLengthMm: bolt.boltLengthMm == null ? null : Number(bolt.boltLengthMm),
          material: bolt.material,
          strengthClass: bolt.strengthClass,
          capabilityGroupId: bolt.capabilityGroupId,
          nominalTorque: Number(bolt.nominalTorque),
          lowerLimit: Number(bolt.lowerLimit),
          upperLimit: Number(bolt.upperLimit),
          unit: bolt.unit,
          kioskDocumentId: bolt.kioskDocumentId,
          assemblyProcedureDocumentId: bolt.assemblyProcedureDocumentId,
          pageIndex: bolt.pageIndex
        }))
      }));
    const checkItems =
      input.checkItems ??
      source.checkItems.map((item) => ({
        markerNo: item.markerNo,
        label: item.label,
        required: item.required,
        xRatio: item.xRatio,
        yRatio: item.yRatio,
        calloutTipXRatio: item.calloutTipXRatio,
        calloutTipYRatio: item.calloutTipYRatio,
        sortOrder: item.sortOrder,
        kioskDocumentId: item.kioskDocumentId,
        assemblyProcedureDocumentId: item.assemblyProcedureDocumentId,
        pageIndex: item.pageIndex
      }));
    return this.create({
      modelCode: input.modelCode ?? source.modelCode,
      procedurePattern: input.procedurePattern ?? source.procedurePattern,
      name: input.name ?? source.name,
      procedureDocumentId: input.procedureDocumentId ?? source.procedureDocumentId,
      areas,
      checkItems,
      traceabilityMode: input.traceabilityMode ?? source.traceabilityMode
    });
  }

  async retire(id: string) {
    try {
      await prisma.assemblyTemplate.update({
        where: { id },
        data: { isActive: false }
      });
      return 'retired' as const;
    } catch {
      return 'not_found' as const;
    }
  }
}
