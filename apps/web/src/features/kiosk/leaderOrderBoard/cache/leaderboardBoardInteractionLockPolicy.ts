/**
 * 背景再検証中・mutation 実行中は順位ボード操作をロックする。
 */
/** ユーザー操作の書き込み中のみロック（120秒背景再検証中は操作可・表示は patch/IDB で整合） */
export function isLeaderboardBoardInteractionLocked(input: {
  isMutationInFlight: boolean;
}): boolean {
  return input.isMutationInFlight;
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
