import type { DataSource } from '../data-source.interface.js';
import type { TableVisualizationData, VisualizationData } from '../../visualization.types.js';
import { prisma } from '../../../../lib/prisma.js';

const DEFAULT_PERIOD_DAYS = 7;
const MAX_PERIOD_DAYS = 90;
const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 200;

function clampNumber(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function parseNumber(value: unknown, fallback: number): number {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === 'string') {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return fallback;
}

function toRecord(value: unknown): Record<string, unknown> {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

function normalizeCell(value: unknown): string | number | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string' || typeof value === 'number') return value;
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

export class CsvDashboardTableDataSource implements DataSource {
  readonly type = 'csv_dashboard_table';

  async fetchData(config: Record<string, unknown>): Promise<VisualizationData> {
    const csvDashboardId = typeof config.csvDashboardId === 'string' ? config.csvDashboardId : '';
    if (!csvDashboardId) {
      return {
        kind: 'table',
        columns: [],
        rows: [],
        metadata: { error: 'csvDashboardId is required' }
      };
    }

    const periodDaysRaw = parseNumber(config.periodDays, DEFAULT_PERIOD_DAYS);
    const periodDays = clampNumber(periodDaysRaw, 1, MAX_PERIOD_DAYS);
    const limitRaw = parseNumber(config.limit, DEFAULT_LIMIT);
    const limit = clampNumber(limitRaw, 1, MAX_LIMIT);

    const now = new Date();
    const startDate = new Date(now);
    startDate.setDate(now.getDate() - periodDays);

    const rows = await prisma.csvDashboardRow.findMany({
      where: {
        csvDashboardId,
        occurredAt: { gte: startDate }
      },
      orderBy: { occurredAt: 'desc' },
      take: limit,
      select: {
        rowData: true
      }
    });

    const configuredColumns = Array.isArray(config.columns)
      ? config.columns.filter((col): col is string => typeof col === 'string' && col.length > 0)
      : [];

    const firstRow = rows[0]?.rowData;
    const inferredColumns = Object.keys(toRecord(firstRow));
    const columns = configuredColumns.length > 0 ? configuredColumns : inferredColumns;

    const normalizedRows: TableVisualizationData['rows'] = rows.map((row) => {
      const record = toRecord(row.rowData);
      const entry: Record<string, string | number | null> = {};
      for (const column of columns) {
        entry[column] = normalizeCell(record[column]);
      }
      return entry;
    });

    return {
      kind: 'table',
      columns,
      rows: normalizedRows,
      metadata: {
        csvDashboardId,
        periodDays,
        limit
      }
    };
  }
}
