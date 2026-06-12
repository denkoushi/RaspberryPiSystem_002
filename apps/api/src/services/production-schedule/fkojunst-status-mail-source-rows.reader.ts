import type { Prisma, PrismaClient } from '@prisma/client';

import { PRODUCTION_SCHEDULE_FKOJUNST_STATUS_MAIL_DASHBOARD_ID } from './constants.js';

/** {@link dedupeFkojunstMailRowsByLatest} の tie-break（同一 FUPDTEDT は先勝ち）を固定する読込順。 */
export const FKOJUNST_STATUS_MAIL_SOURCE_ROW_ORDER_BY = [
  { sourceIngestRun: { completedAt: 'asc' as const } },
  { sourceIngestRunStartedAt: 'asc' as const },
  { sourceRowOrdinal: 'asc' as const },
  { createdAt: 'asc' as const },
  { id: 'asc' as const }
] satisfies Prisma.CsvDashboardRowOrderByWithRelationInput[];

export type FkojunstStatusMailSourceRow = {
  id: string;
  rowData: unknown;
  createdAt: Date;
  updatedAt?: Date | null;
  sourceRowOrdinal?: number | null;
  sourceIngestRunStartedAt?: Date | null;
  sourceIngestRunCompletedAt?: Date | null;
};

type CsvDashboardRowClient = Pick<PrismaClient, 'csvDashboardRow'>;

export async function fetchFkojunstStatusMailSourceRowsOrdered(
  client: CsvDashboardRowClient
): Promise<FkojunstStatusMailSourceRow[]> {
  return client.csvDashboardRow.findMany({
    where: {
      csvDashboardId: PRODUCTION_SCHEDULE_FKOJUNST_STATUS_MAIL_DASHBOARD_ID,
      OR: [
        { sourceIngestRunId: null },
        { sourceIngestRun: { status: 'COMPLETED', completedAt: { not: null } } }
      ]
    },
    select: {
      id: true,
      rowData: true,
      createdAt: true,
      updatedAt: true,
      sourceRowOrdinal: true,
      sourceIngestRunStartedAt: true,
      sourceIngestRun: {
        select: { completedAt: true }
      }
    },
    orderBy: [...FKOJUNST_STATUS_MAIL_SOURCE_ROW_ORDER_BY]
  }).then((rows) =>
    rows.map((row) => ({
      ...row,
      sourceIngestRunCompletedAt: row.sourceIngestRun?.completedAt ?? null,
      sourceIngestRun: undefined
    }))
  );
}
