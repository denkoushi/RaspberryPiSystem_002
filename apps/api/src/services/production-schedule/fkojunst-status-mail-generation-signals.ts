import { fetchFkojunstStatusMailGenerationRevision } from './fkojunst-status-mail-generation-revision.js';
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

/**
 * raw rows と永続 revision（`CsvDashboardRawRevision`、トリガーで行・取り込み run の変更ごとに増える）を返す。
 * revision は rows より先に読むため、rows が revision より古くなることはない（途中の変更は次回の不一致で再計算）。
 */
export async function fetchFkojunstStatusMailSourceRowsWithGenerationSignals(
  client: Parameters<typeof fetchFkojunstStatusMailSourceRowsOrdered>[0]
): Promise<{
  sourceRows: FkojunstStatusMailSourceRow[];
  signals: FkojunstStatusMailGenerationSignals;
}> {
  const rowsRevision = await fetchFkojunstStatusMailGenerationRevision(client);
  const sourceRows = await fetchFkojunstStatusMailSourceRowsOrdered(client);
  const signals = buildFkojunstStatusMailGenerationSignals({ sourceRows, rowsRevision });
  return { sourceRows, signals };
}

/** 同期トランザクション内の世代確認。raw rows を集計せず永続 revision だけを読む。 */
export async function fetchFkojunstStatusMailGenerationSignals(
  client: FkojunstStatusMailGenerationSignalsClient
): Promise<Pick<FkojunstStatusMailGenerationSignals, 'rowsRevision'>> {
  return { rowsRevision: await fetchFkojunstStatusMailGenerationRevision(client) };
}
