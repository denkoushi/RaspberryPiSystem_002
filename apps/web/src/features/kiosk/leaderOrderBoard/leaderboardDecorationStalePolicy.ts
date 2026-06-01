import { buildLeaderBoardPartResourceProcessKey } from './buildLeaderBoardPartResourceProcessKey';

import type { LeaderboardBoardCacheMutation } from './cache/leaderboardBoardApplyMutation';
import type { ProductionScheduleRow } from '../../../api/client';

/** footer chip の完了表示に効く board 行の軽量トークン（`rowData.progress`） */
export function buildLeaderboardRowDecorationProgressToken(
  row: Pick<ProductionScheduleRow, 'rowData'>
): string {
  const data = (row.rowData ?? {}) as Record<string, unknown>;
  const progress = typeof data.progress === 'string' ? data.progress.trim() : '';
  return progress;
}

/** サーバが部品単位で工程チップを組み立てるキー（表示行と同型） */
export function buildLeaderboardPartKeyFromScheduleRow(
  row: Pick<ProductionScheduleRow, 'seibanJoinKey' | 'rowData'>
): string {
  const data = (row.rowData ?? {}) as Record<string, unknown>;
  const seibanJoinKey =
    typeof row.seibanJoinKey === 'string' && row.seibanJoinKey.trim().length > 0
      ? row.seibanJoinKey.trim()
      : typeof data.FSEIBAN === 'string'
        ? data.FSEIBAN.trim()
        : '';
  return buildLeaderBoardPartResourceProcessKey({
    seibanJoinKey,
    productNo: typeof data.ProductNo === 'string' ? data.ProductNo.trim() : '',
    fhincd: typeof data.FHINCD === 'string' ? data.FHINCD.trim() : ''
  });
}

export type LeaderboardDecorationFetchStaleOptions = {
  /** ネットワーク board 再同期の指紋（shell 更新・ポーリング refetch） */
  boardNetworkSyncToken: string;
  /** partKey → 直近 footer 取得成功時の boardNetworkSyncToken */
  footerFetchedBoardSyncTokenByPartKey: ReadonlyMap<string, string>;
};

/**
 * 装飾再取得が必要な rowId（重複なし）。
 * - `progress` 変化: 行単位で pending
 * - footer 再検証: partKey あたり代表 row 1 件のみ（同一 part の複数表示行をまとめる）
 */
export function listLeaderboardRowIdsNeedingDecorationFetch(
  rows: readonly Pick<ProductionScheduleRow, 'id' | 'seibanJoinKey' | 'rowData'>[],
  fetchedProgressByRowId: ReadonlyMap<string, string>,
  staleOptions: LeaderboardDecorationFetchStaleOptions
): string[] {
  const pending = new Set<string>();
  const representativeRowIdByPartKey = new Map<string, string>();
  const partKeysCoveredByProgressPending = new Set<string>();

  for (const row of rows) {
    const rowId = row.id.trim();
    if (rowId.length === 0) continue;

    const partKey = buildLeaderboardPartKeyFromScheduleRow(row);
    if (!representativeRowIdByPartKey.has(partKey)) {
      representativeRowIdByPartKey.set(partKey, rowId);
    }

    const token = buildLeaderboardRowDecorationProgressToken(row);
    const previousProgress = fetchedProgressByRowId.get(rowId);
    if (previousProgress === undefined || previousProgress !== token) {
      pending.add(rowId);
      partKeysCoveredByProgressPending.add(partKey);
    }
  }

  const boardSync = staleOptions.boardNetworkSyncToken;
  if (boardSync.length > 0) {
    for (const [partKey, representativeRowId] of representativeRowIdByPartKey) {
      const previousFooterSync = staleOptions.footerFetchedBoardSyncTokenByPartKey.get(partKey);
      const footerStale = previousFooterSync !== boardSync;
      if (footerStale && !partKeysCoveredByProgressPending.has(partKey)) {
        pending.add(representativeRowId);
      }
    }
  }

  return [...pending];
}

/** completion 時のみ装飾（footer chip 等）の再取得対象とする rowId */
export function resolveStaleDecorationRowIds(
  mutation: LeaderboardBoardCacheMutation
): readonly string[] {
  if (mutation.kind !== 'completion') {
    return [];
  }
  const rowId = mutation.rowId.trim();
  return rowId.length > 0 ? [rowId] : [];
}

/** 前回取得済みトークンを削除し、次の増分取得で pending に戻す（手動完了 mutation 用） */
export function removeLeaderboardFetchedDecorationProgressTokens(
  fetchedProgressByRowId: Map<string, string>,
  rowIds: readonly string[]
): void {
  for (const id of rowIds) {
    const trimmed = id.trim();
    if (trimmed.length === 0) continue;
    fetchedProgressByRowId.delete(trimmed);
  }
}

export function removeLeaderboardFetchedFooterSyncTokensForRows(
  footerFetchedBoardSyncTokenByPartKey: Map<string, string>,
  rows: readonly Pick<ProductionScheduleRow, 'id' | 'seibanJoinKey' | 'rowData'>[],
  rowIds: readonly string[]
): void {
  const rowsById = new Map(rows.map((row) => [row.id.trim(), row] as const));
  for (const id of rowIds) {
    const row = rowsById.get(id.trim());
    if (!row) continue;
    footerFetchedBoardSyncTokenByPartKey.delete(buildLeaderboardPartKeyFromScheduleRow(row));
  }
}
