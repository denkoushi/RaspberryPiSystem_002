/**
 * 背景再検証中・mutation 実行中は順位ボード操作をロックする。
 */
export function isLeaderboardBoardInteractionLocked(input: {
  isBackgroundRevalidating: boolean;
  isMutationInFlight: boolean;
}): boolean {
  return input.isBackgroundRevalidating || input.isMutationInFlight;
}

export function isLeaderboardBoardBackgroundRevalidating(input: {
  scheduleEnabled: boolean;
  networkBoardComplete: boolean;
  networkInitialLoading: boolean;
  networkIsFetching: boolean;
  isAppending: boolean;
  isDecorationsFetching: boolean;
}): boolean {
  if (!input.scheduleEnabled) return false;
  if (input.networkInitialLoading) return true;
  if (input.networkIsFetching) return true;
  if (input.isAppending) return true;
  if (input.isDecorationsFetching) return true;
  if (!input.networkBoardComplete) return true;
  return false;
}

export const LEADERBOARD_BACKGROUND_SYNC_STATUS_MESSAGE =
  '一覧を更新中です。完了まで操作できません。';
