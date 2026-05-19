import { partitionLeaderboardCompositeRowsBySlotOrder } from '../mergeLeaderboardBoardContinueResponse';

import type {
  ProductionScheduleLeaderboardBoardResponse,
  ProductionScheduleRow
} from '../../../../api/client';

function readRowFseiban(row: ProductionScheduleRow): string {
  const topLevelValue = (row as unknown as { fseiban?: unknown }).fseiban;
  const topLevel = typeof topLevelValue === 'string' ? topLevelValue.trim() : '';
  if (topLevel.length > 0) return topLevel;
  const data = row.rowData as Record<string, unknown> | undefined;
  if (!data) return '';
  const raw = data.FSEIBAN;
  return typeof raw === 'string' ? raw.trim() : '';
}

export function normalizeLeaderboardSeibanOrTokens(seibanTokens: readonly string[]): string[] {
  return Array.from(
    new Set(
      seibanTokens
        .map((s) => s.trim())
        .filter((s) => s.length > 0)
    )
  );
}

function rowMatchesSeibanOr(row: ProductionScheduleRow, tokenSet: ReadonlySet<string>): boolean {
  const fseiban = readRowFseiban(row);
  return fseiban.length > 0 && tokenSet.has(fseiban);
}

/**
 * 完走済み無 `q` board を登録製番 OR（完全一致）で絞る。
 * `seibanTokens` が空のときは `board` をそのまま返す。
 * スロット分割不能時は `null`（安全側）。
 */
export function filterLeaderboardBoardBySeibanOr(
  board: ProductionScheduleLeaderboardBoardResponse,
  seibanTokens: readonly string[],
  orderedSlotResourceCds: readonly string[]
): ProductionScheduleLeaderboardBoardResponse | null {
  const normalized = normalizeLeaderboardSeibanOrTokens(seibanTokens);
  if (normalized.length === 0) return board;

  const tokenSet = new Set(normalized);
  const slices = partitionLeaderboardCompositeRowsBySlotOrder(board.rows, orderedSlotResourceCds);
  if (slices == null) return null;

  const filteredSlices = slices.map((slice) => slice.filter((r) => rowMatchesSeibanOr(r, tokenSet)));
  const filteredRows = filteredSlices.flat();

  const resources = board.resources.map((resource, index) => {
    const count = filteredSlices[index]?.length ?? 0;
    return {
      ...resource,
      total: count,
      hasMore: false,
      nextCursor: count
    };
  });

  return {
    ...board,
    page: board.page,
    pageSize: board.pageSize,
    total: filteredRows.length,
    rows: filteredRows,
    resources
  };
}
