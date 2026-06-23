import { Prisma } from '@prisma/client';

import { PRODUCTION_SCHEDULE_FKOJUNST_STATUS_MAIL_DASHBOARD_ID } from './constants.js';
import {
  fetchFkojunstStatusMailSourceRowsOrdered,
  type FkojunstStatusMailSourceRow
} from './fkojunst-status-mail-source-rows.reader.js';

export type FkojunstStatusMailGenerationSignals = {
  rowsCount: number;
  rowsLatestCreatedAt: string;
  rowsRevision: string;
};

type FkojunstStatusMailGenerationSignalsClient = Pick<
  Parameters<typeof fetchFkojunstStatusMailSourceRowsOrdered>[0],
  '$queryRaw'
>;

type FkojunstStatusMailGenerationSignalsRow = {
  rowsCount: bigint;
  rowsLatestCreatedAt: Date | null;
  rowsLatestUpdatedAt: Date | null;
};

function normalizeDate(value: Date | null | undefined): string {
  return value instanceof Date ? value.toISOString() : '';
}

function summarizeSourceRows(sourceRows: readonly FkojunstStatusMailSourceRow[]): {
  rowsCount: number;
  rowsLatestCreatedAt: string;
  rowsLatestUpdatedAt: string;
} {
  let rowsLatestCreatedAt = '';
  let rowsLatestUpdatedAt = '';
  for (const row of sourceRows) {
    const createdAt = normalizeDate(row.createdAt);
    if (createdAt > rowsLatestCreatedAt) {
      rowsLatestCreatedAt = createdAt;
    }
    const updatedAt = normalizeDate(row.updatedAt ?? row.createdAt);
    if (updatedAt > rowsLatestUpdatedAt) {
      rowsLatestUpdatedAt = updatedAt;
    }
  }
  return {
    rowsCount: sourceRows.length,
    rowsLatestCreatedAt,
    rowsLatestUpdatedAt
  };
}

function buildRevisionToken(params: {
  rowsCount: number;
  rowsLatestCreatedAt: string;
  rowsLatestUpdatedAt: string;
}): string {
  return `${params.rowsCount}:${params.rowsLatestCreatedAt}:${params.rowsLatestUpdatedAt}`;
}

export function buildFkojunstStatusMailGenerationSignals(params: {
  sourceRows: readonly FkojunstStatusMailSourceRow[];
  rowsRevision?: string;
}): FkojunstStatusMailGenerationSignals {
  const summary = summarizeSourceRows(params.sourceRows);
  return {
    rowsCount: summary.rowsCount,
    rowsLatestCreatedAt: summary.rowsLatestCreatedAt,
    rowsRevision:
      params.rowsRevision != null && params.rowsRevision.length > 0
        ? params.rowsRevision
        : buildRevisionToken(summary)
  };
}

export async function fetchFkojunstStatusMailSourceRowsWithGenerationSignals(
  client: Parameters<typeof fetchFkojunstStatusMailSourceRowsOrdered>[0]
): Promise<{
  sourceRows: FkojunstStatusMailSourceRow[];
  signals: FkojunstStatusMailGenerationSignals;
}> {
  const sourceRows = await fetchFkojunstStatusMailSourceRowsOrdered(client);
  const signals = buildFkojunstStatusMailGenerationSignals({ sourceRows });
  return { sourceRows, signals };
}

export async function fetchFkojunstStatusMailGenerationSignals(
  client: FkojunstStatusMailGenerationSignalsClient
): Promise<FkojunstStatusMailGenerationSignals> {
  const rows = await client.$queryRaw<FkojunstStatusMailGenerationSignalsRow[]>(Prisma.sql`
    SELECT
      COUNT(*)::bigint AS "rowsCount",
      MAX(r."createdAt") AS "rowsLatestCreatedAt",
      MAX(COALESCE(r."updatedAt", r."createdAt")) AS "rowsLatestUpdatedAt"
    FROM "CsvDashboardRow" r
    WHERE r."csvDashboardId" = ${PRODUCTION_SCHEDULE_FKOJUNST_STATUS_MAIL_DASHBOARD_ID}
      AND (
        r."sourceIngestRunId" IS NULL
        OR EXISTS (
          SELECT 1
          FROM "CsvDashboardIngestRun" ir
          WHERE ir."id" = r."sourceIngestRunId"
            AND ir."status" = 'COMPLETED'::"ImportStatus"
            AND ir."completedAt" IS NOT NULL
        )
      )
  `);
  const row = rows[0];
  const summary = {
    rowsCount: Number(row?.rowsCount ?? 0n),
    rowsLatestCreatedAt: normalizeDate(row?.rowsLatestCreatedAt),
    rowsLatestUpdatedAt: normalizeDate(row?.rowsLatestUpdatedAt)
  };
  return {
    rowsCount: summary.rowsCount,
    rowsLatestCreatedAt: summary.rowsLatestCreatedAt,
    rowsRevision: buildRevisionToken(summary)
  };
}
