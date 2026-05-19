import { isLeaderboardSeibanOrClientFilterEnabled } from './leaderboardBoardCacheConstants';
import { isCompleteLeaderboardBoardSnapshot } from './leaderboardBoardCacheRecord';

import type { ProductionScheduleLeaderboardBoardResponse } from '../../../../api/client';

export type CanApplyLeaderboardSeibanClientFilterInput = {
  seibanOrFilters: readonly string[];
  baseBoard: ProductionScheduleLeaderboardBoardResponse | undefined;
};

/**
 * 無 `q` 完走 board を登録製番 OR でクライアント表示してよいか。
 * ツールバー等の他 `q` 経路には使わない。
 */
export function canApplyLeaderboardSeibanClientFilter(
  input: CanApplyLeaderboardSeibanClientFilterInput
): boolean {
  if (!isLeaderboardSeibanOrClientFilterEnabled()) return false;
  const tokens = input.seibanOrFilters.map((s) => s.trim()).filter((s) => s.length > 0);
  if (tokens.length === 0) return false;
  if (input.baseBoard == null) return false;
  return isCompleteLeaderboardBoardSnapshot(input.baseBoard);
}

/** 表示用: 未完走でも手元の行に製番フィルタをかけてよいか（reconcile は `canApply` 側で完走を待つ） */
export function canDisplayLeaderboardSeibanClientFilter(
  input: CanApplyLeaderboardSeibanClientFilterInput
): boolean {
  if (!isLeaderboardSeibanOrClientFilterEnabled()) return false;
  const tokens = input.seibanOrFilters.map((s) => s.trim()).filter((s) => s.length > 0);
  if (tokens.length === 0) return false;
  return input.baseBoard != null && input.baseBoard.rows.length > 0;
}
