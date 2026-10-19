import { readProductionBuildConfig } from '../../../../config/productionBuildConfig';
import { LEADER_BOARD_SCHEDULE_REFETCH_MS } from '../performance/leaderBoardRefetchPolicy';

/** v3: 行に machineRequiredMinutes / laborRequiredMinutes を含む（v2 キャッシュは破棄） */
export const LEADERBOARD_BOARD_CACHE_SCHEMA_VERSION = 3;

export const LEADERBOARD_BOARD_CACHE_IDB_NAME = 'kiosk-leader-order-board-cache';
export const LEADERBOARD_BOARD_CACHE_IDB_STORE = 'boardSnapshots';

/** 鮮度許容（現ポーリング間隔と整合） */
export const LEADERBOARD_BOARD_CACHE_MAX_AGE_MS = LEADER_BOARD_SCHEDULE_REFETCH_MS;

export const LEADERBOARD_BOARD_CACHE_SYNC_WARNING =
  '一覧の更新に失敗しました。表示は前回保存分です。';

export function isLeaderboardBoardTerminalCacheEnabled(): boolean {
  return readProductionBuildConfig().leaderboardTerminalCacheEnabled;
}

/** Phase 2 SWR 表示（省略時 true・端末キャッシュ無効時は常に false） */
export function isLeaderboardBoardTerminalCachePhase2SwrEnabled(): boolean {
  if (!isLeaderboardBoardTerminalCacheEnabled()) return false;
  return readProductionBuildConfig().leaderboardTerminalCachePhase2Swr;
}

/** mutation 成功時の IDB 即時ミラー（省略時 true・緊急オフは env false） */
export function isLeaderboardBoardCacheWriteOnMutationEnabled(): boolean {
  return readProductionBuildConfig().leaderboardCacheWriteOnMutation;
}

/** 登録製番 OR を無 `q` 完走 board へクライアントフィルタ（省略時 true） */
export function isLeaderboardSeibanOrClientFilterEnabled(): boolean {
  return readProductionBuildConfig().leaderboardSeibanOrClientFilter;
}
