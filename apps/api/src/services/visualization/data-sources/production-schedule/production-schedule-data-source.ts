import { Prisma } from '@prisma/client';
import type { DataSource } from '../data-source.interface.js';
import type { TableVisualizationData, VisualizationData } from '../../visualization.types.js';
import { prisma } from '../../../../lib/prisma.js';
import { PRODUCTION_SCHEDULE_DASHBOARD_ID, COMPLETED_PROGRESS_VALUE } from '../../../production-schedule/constants.js';

const SHARED_LOCATION_KEY = 'shared';
const CACHE_TTL_MS = 10 * 60 * 1000;

type ProgressRow = {
  fseiban: string;
  productNo: string | null;
  productName: string | null;
  total: number;
  completed: number;
};

function normalizeHistory(values: string[]): string[] {
  const unique = new Set<string>();
  const next: string[] = [];
  values
    .map((value) => value.trim())
    .filter((value) => value.length > 0)
    .forEach((value) => {
      if (unique.has(value)) return;
      unique.add(value);
      next.push(value);
    });
  return next.slice(0, 8);
}

function toRowMap(rows: ProgressRow[]): Map<string, ProgressRow> {
  return new Map(rows.map((row) => [row.fseiban, row]));
}

function toPercent(completed: number, total: number): number {
  if (total <= 0) return 0;
  return Math.round((completed / total) * 100);
}

export class ProductionScheduleDataSource implements DataSource {
  readonly type = 'production_schedule';
  private cache: { key: string; data: TableVisualizationData; fetchedAt: number } | null = null;

  async fetchData(): Promise<VisualizationData> {
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

    const history = normalizeHistory(((sharedState?.state as { history?: string[] } | null)?.history ?? []) as string[]);
    const cacheKey = history.join('|');
    const now = Date.now();

    if (this.cache && this.cache.key === cacheKey && now - this.cache.fetchedAt <= CACHE_TTL_MS) {
      return this.cache.data;
    }

    const columns: TableVisualizationData['columns'] = [
      'FSEIBAN',
      'FHINMEI',
      'ProductNo',
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

    const rows = await prisma.$queryRaw<ProgressRow[]>`
      SELECT
        ("CsvDashboardRow"."rowData"->>'FSEIBAN') AS "fseiban",
        MAX("CsvDashboardRow"."rowData"->>'ProductNo') AS "productNo",
        MAX("CsvDashboardRow"."rowData"->>'FHINMEI') AS "productName",
        COUNT(*)::int AS "total",
        SUM(
          CASE
            WHEN ("CsvDashboardRow"."rowData"->>'progress') = ${COMPLETED_PROGRESS_VALUE}
            THEN 1
            ELSE 0
          END
        )::int AS "completed"
      FROM "CsvDashboardRow"
      WHERE "CsvDashboardRow"."csvDashboardId" = ${PRODUCTION_SCHEDULE_DASHBOARD_ID}
        AND ("CsvDashboardRow"."rowData"->>'FSEIBAN') IN (${Prisma.join(
          history.map((value) => Prisma.sql`${value}`),
          ','
        )})
      GROUP BY ("CsvDashboardRow"."rowData"->>'FSEIBAN')
      ORDER BY ("CsvDashboardRow"."rowData"->>'FSEIBAN') ASC
    `;

    const rowMap = toRowMap(rows);

    const normalizedRows: TableVisualizationData['rows'] = history.map((fseiban) => {
      const row = rowMap.get(fseiban);
      const total = row?.total ?? 0;
      const completed = row?.completed ?? 0;
      const percent = toPercent(completed, total);
      const status = total > 0 && completed === total ? '完了' : '未完了';

      return {
        FSEIBAN: fseiban,
        FHINMEI: row?.productName ?? '',
        ProductNo: row?.productNo ?? '',
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
      },
    };

    this.cache = { key: cacheKey, data, fetchedAt: now };
    return data;
  }
}
