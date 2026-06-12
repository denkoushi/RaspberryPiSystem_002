import {
  fetchFkojunstStatusMailSourceRowsOrdered,
  type FkojunstStatusMailSourceRow
} from './fkojunst-status-mail-source-rows.reader.js';

export type FkojunstStatusMailGenerationSignals = {
  rowsCount: number;
  rowsLatestCreatedAt: string;
  rowsRevision: string;
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
