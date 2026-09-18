import { normalizeKioskProductionScheduleSearchHistory } from '@raspi-system/shared-types';
import type { DataSource } from '../data-source.interface.js';
import type { KpiVisualizationData, SeriesVisualizationData, TableVisualizationData, VisualizationData } from '../../visualization.types.js';
import { prisma } from '../../../../lib/prisma.js';
import { fetchSeibanProgressRows } from '../../../production-schedule/seiban-progress.service.js';
import { PRODUCTION_SCHEDULE_DASHBOARD_ID } from '../../../production-schedule/constants.js';

const SHARED_LOCATION_KEY = 'shared';
const CACHE_TTL_MS = 10 * 60 * 1000;
const MAX_INCOMPLETE_PARTS_STORED = 50;

type ProgressRow = {
  fseiban: string;
  total: number;
  completed: number;
  incompleteProductNames: string[] | null;
};

function toRowMap(rows: ProgressRow[]): Map<string, ProgressRow> {
  return new Map(rows.map((row) => [row.fseiban, row]));
}

function toPercent(completed: number, total: number): number {
  if (total <= 0) return 0;
  return Math.round((completed / total) * 100);
}

function normalizeParts(values: (string | null)[]): string[] {
  const trimmed = values.map((value) => (value ?? '').trim()).filter((value) => value.length > 0);
  const unique = Array.from(new Set(trimmed));
  return unique.sort((a, b) => a.localeCompare(b, 'ja'));
}

export class ProductionScheduleDataSource implements DataSource {
  readonly type = 'production_schedule';
  private cache: { key: string; data: TableVisualizationData; fetchedAt: number } | null = null;

  async fetchData(config: Record<string, unknown> = {}): Promise<VisualizationData> {
    const table = await this.fetchTableData(config);
    const view = config.view === 'kpi' || config.view === 'series' ? config.view : 'table';
    if (view === 'kpi') return toKpiData(table);
    if (view === 'series') return toSeriesData(table);
    return table;
  }

  private async fetchTableData(config: Record<string, unknown>): Promise<TableVisualizationData> {
    const sharedState = await prisma.kioskProductionScheduleSearchState.findUnique({
      where: {
        csvDashboardId_location: {
          csvDashboardId: PRODUCTION_SCHEDULE_DASHBOARD_ID,
          location: SHARED_LOCATION_KEY,
        },
      },
      select: {
        state: true,
        updatedAt: true,
      },
    });

    const history = normalizeKioskProductionScheduleSearchHistory(
      ((sharedState?.state as { history?: string[] } | null)?.history ?? []) as string[]
    );
    const cacheKey = history.join('|');
    const now = Date.now();

    if (config.refresh !== true && this.cache && this.cache.key === cacheKey && now - this.cache.fetchedAt <= CACHE_TTL_MS) {
      return this.cache.data;
    }

    const columns: TableVisualizationData['columns'] = [
      'FSEIBAN',
      'INCOMPLETE_PARTS',
      'completed',
      'total',
      'percent',
      'status',
    ];

    if (history.length === 0) {
      const emptyData: TableVisualizationData = {
        kind: 'table',
        columns,
        rows: [],
        metadata: {
          reason: 'history_empty',
          updatedAt: sharedState?.updatedAt ?? null,
        },
      };
      this.cache = { key: cacheKey, data: emptyData, fetchedAt: now };
      return emptyData;
    }

    const rows = await fetchSeibanProgressRows(history);

    const rowMap = toRowMap(rows);

    const incompletePartsBySeiban: Record<string, string[]> = {};
    const incompletePartsTotalBySeiban: Record<string, number> = {};

    const normalizedRows: TableVisualizationData['rows'] = history
      .filter((fseiban) => rowMap.has(fseiban))
      .map((fseiban) => {
      const row = rowMap.get(fseiban);
      const total = row?.total ?? 0;
      const completed = row?.completed ?? 0;
      const percent = toPercent(completed, total);
      const status = total > 0 && completed === total ? '完了' : '未完了';
      const normalizedParts = normalizeParts(row?.incompleteProductNames ?? []);
      const storedParts = normalizedParts.slice(0, MAX_INCOMPLETE_PARTS_STORED);
      incompletePartsBySeiban[fseiban] = storedParts;
      incompletePartsTotalBySeiban[fseiban] = normalizedParts.length;
      const incompleteParts = storedParts.join(', ');

      return {
        FSEIBAN: fseiban,
        INCOMPLETE_PARTS: incompleteParts,
        completed,
        total,
        percent,
        status,
      };
      });

    const data: TableVisualizationData = {
      kind: 'table',
      columns,
      rows: normalizedRows,
      metadata: {
        updatedAt: sharedState?.updatedAt ?? null,
        cacheTtlSeconds: CACHE_TTL_MS / 1000,
        incompletePartsBySeiban,
        incompletePartsTotalBySeiban,
        maxIncompletePartsStored: MAX_INCOMPLETE_PARTS_STORED,
      },
    };

    this.cache = { key: cacheKey, data, fetchedAt: now };
    return data;
  }
}

function toKpiData(table: TableVisualizationData): KpiVisualizationData {
  const totalSeiban = table.rows.length;
  const totalParts = table.rows.reduce((sum, row) => sum + toFiniteNumber(row.total), 0);
  const completedParts = table.rows.reduce((sum, row) => sum + toFiniteNumber(row.completed), 0);
  const progressRate = totalParts > 0 ? Math.round((completedParts / totalParts) * 100) : 0;
  return {
    kind: 'kpi',
    items: [
      { label: '対象製番数', value: totalSeiban, unit: '件' },
      { label: '総部品数', value: totalParts, unit: '件' },
      { label: '完了部品数', value: completedParts, unit: '件', isGood: true },
      { label: '全体進捗率', value: progressRate, unit: '%', isGood: progressRate >= 70 },
    ],
    metadata: table.metadata,
  };
}

function toSeriesData(table: TableVisualizationData): SeriesVisualizationData {
  return {
    kind: 'series',
    labels: table.rows.map((row) => String(row.FSEIBAN ?? '未設定')),
    datasets: [{
      label: '進捗率',
      values: table.rows.map((row) => toFiniteNumber(row.percent)),
    }],
    metadata: table.metadata,
  };
}

function toFiniteNumber(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && Number.isFinite(Number(value))) return Number(value);
  return 0;
}
