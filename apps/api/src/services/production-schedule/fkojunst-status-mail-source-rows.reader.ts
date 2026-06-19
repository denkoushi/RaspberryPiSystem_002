import type { Prisma, PrismaClient } from '@prisma/client';
import { Prisma as PrismaNamespace } from '@prisma/client';

import { PRODUCTION_SCHEDULE_FKOJUNST_STATUS_MAIL_DASHBOARD_ID } from './constants.js';

/**
 * {@link dedupeFkojunstMailRowsByLatest} の tie-break（同一 FUPDTEDT は先勝ち）を固定する読込順。
 * Prisma orderBy 形と raw SQL 断片は同一 spec から導出し、片方だけ更新される drift を防ぐ。
 */
const FKOJUNST_STATUS_MAIL_SOURCE_ROW_ORDER_SPEC = [
  {
    prisma: { sourceIngestRun: { completedAt: 'asc' as const } },
    sql: 'ir."completedAt" ASC'
  },
  {
    prisma: { sourceIngestRunStartedAt: 'asc' as const },
    sql: 'r."sourceIngestRunStartedAt" ASC'
  },
  {
    prisma: { sourceRowOrdinal: 'asc' as const },
    sql: 'r."sourceRowOrdinal" ASC'
  },
  {
    prisma: { createdAt: 'asc' as const },
    sql: 'r."createdAt" ASC'
  },
  {
    prisma: { id: 'asc' as const },
    sql: 'r."id" ASC'
  }
] as const;

export const FKOJUNST_STATUS_MAIL_SOURCE_ROW_ORDER_BY = FKOJUNST_STATUS_MAIL_SOURCE_ROW_ORDER_SPEC.map(
  (entry) => entry.prisma
) satisfies Prisma.CsvDashboardRowOrderByWithRelationInput[];

/** raw SQL reader が使う ORDER BY 断片（順序付き）。テストで tie-break 順を固定する。 */
export const FKOJUNST_STATUS_MAIL_SOURCE_ROW_SQL_ORDER_BY = FKOJUNST_STATUS_MAIL_SOURCE_ROW_ORDER_SPEC.map(
  (entry) => entry.sql
);

export type FkojunstStatusMailSourceRow = {
  id: string;
  rowData: unknown;
  createdAt: Date;
  updatedAt?: Date | null;
  sourceRowOrdinal?: number | null;
  sourceIngestRunStartedAt?: Date | null;
  sourceIngestRunCompletedAt?: Date | null;
};

type CsvDashboardRowClient = Pick<PrismaClient, '$queryRaw'>;

type FkojunstStatusMailProjectedRow = {
  id: string;
  FKOJUN: string | null;
  FKOTEICD: string | null;
  FSEZONO: string | null;
  FKOJUNST: string | null;
  FUPDTEDT: string | null;
  createdAt: Date;
  updatedAt: Date | null;
  sourceRowOrdinal: number | null;
  sourceIngestRunStartedAt: Date | null;
  sourceIngestRunCompletedAt: Date | null;
};

function buildProjectedFkojunstStatusMailRowData(row: FkojunstStatusMailProjectedRow): Record<string, string> {
  return {
    FKOJUN: row.FKOJUN ?? '',
    FKOTEICD: row.FKOTEICD ?? '',
    FSEZONO: row.FSEZONO ?? '',
    FKOJUNST: row.FKOJUNST ?? '',
    FUPDTEDT: row.FUPDTEDT ?? ''
  };
}

export async function fetchFkojunstStatusMailSourceRowsOrdered(
  client: CsvDashboardRowClient
): Promise<FkojunstStatusMailSourceRow[]> {
  const rows = await client.$queryRaw<FkojunstStatusMailProjectedRow[]>(PrismaNamespace.sql`
    SELECT
      r."id",
      r."rowData"->>'FKOJUN' AS "FKOJUN",
      r."rowData"->>'FKOTEICD' AS "FKOTEICD",
      r."rowData"->>'FSEZONO' AS "FSEZONO",
      r."rowData"->>'FKOJUNST' AS "FKOJUNST",
      r."rowData"->>'FUPDTEDT' AS "FUPDTEDT",
      r."createdAt",
      r."updatedAt",
      r."sourceRowOrdinal",
      r."sourceIngestRunStartedAt",
      ir."completedAt" AS "sourceIngestRunCompletedAt"
    FROM "CsvDashboardRow" r
    LEFT JOIN "CsvDashboardIngestRun" ir ON ir."id" = r."sourceIngestRunId"
    WHERE r."csvDashboardId" = ${PRODUCTION_SCHEDULE_FKOJUNST_STATUS_MAIL_DASHBOARD_ID}
      AND (
        r."sourceIngestRunId" IS NULL
        OR (ir."status" = 'COMPLETED'::"ImportStatus" AND ir."completedAt" IS NOT NULL)
      )
    ORDER BY ${PrismaNamespace.join(
      FKOJUNST_STATUS_MAIL_SOURCE_ROW_SQL_ORDER_BY.map((fragment) => PrismaNamespace.raw(fragment)),
      ', '
    )}
  `);

  return rows.map((row) => ({
    id: row.id,
    rowData: buildProjectedFkojunstStatusMailRowData(row),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    sourceRowOrdinal: row.sourceRowOrdinal,
    sourceIngestRunStartedAt: row.sourceIngestRunStartedAt,
    sourceIngestRunCompletedAt: row.sourceIngestRunCompletedAt
  }));
}
