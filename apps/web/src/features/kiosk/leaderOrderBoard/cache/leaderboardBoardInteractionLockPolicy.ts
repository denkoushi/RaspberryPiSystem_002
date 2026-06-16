/**
 * 背景再検証中・mutation 実行中は順位ボード操作をロックする。
 */
/** ユーザー操作の書き込み中のみロック（120秒背景再検証中は操作可・表示は patch/IDB で整合） */
export function isLeaderboardBoardInteractionLocked(input: {
  isMutationInFlight: boolean;
}): boolean {
  return input.isMutationInFlight;
}

/** 初回 board / refetch / continue / ページング未完走の同期中 */
export function isLeaderboardBoardDataSyncing(input: {
  scheduleEnabled: boolean;
  networkBoardComplete: boolean;
  networkInitialLoading: boolean;
  networkIsFetching: boolean;
  isAppending: boolean;
}): boolean {
  if (!input.scheduleEnabled) return false;
  if (input.networkInitialLoading) return true;
  if (input.networkIsFetching) return true;
  if (input.isAppending) return true;
  if (!input.networkBoardComplete) return true;
  return false;
}

/** `leaderboard-decorations` POST の同期中 */
export function isLeaderboardDecorationSyncing(input: {
  scheduleEnabled: boolean;
  isDecorationsFetching: boolean;
}): boolean {
  return input.scheduleEnabled && input.isDecorationsFetching;
}

/** 端末キャッシュ SWR 維持用: board/continue と decorations のいずれかが同期中 */
export function isLeaderboardBoardBackgroundRevalidating(input: {
  scheduleEnabled: boolean;
  networkBoardComplete: boolean;
  networkInitialLoading: boolean;
  networkIsFetching: boolean;
  isAppending: boolean;
  isDecorationsFetching: boolean;
}): boolean {
  return (
    isLeaderboardBoardDataSyncing(input) ||
    isLeaderboardDecorationSyncing(input)
  );
}

export const LEADERBOARD_BACKGROUND_SYNC_STATUS_MESSAGE = '一覧を更新中です。';

export const LEADERBOARD_DECORATION_SYNC_STATUS_MESSAGE = '詳細情報を更新中です。';
