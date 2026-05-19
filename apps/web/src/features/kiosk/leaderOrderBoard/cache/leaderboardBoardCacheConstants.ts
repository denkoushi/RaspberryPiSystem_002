import { LEADER_BOARD_SCHEDULE_REFETCH_MS } from '../performance/leaderBoardRefetchPolicy';

export const LEADERBOARD_BOARD_CACHE_SCHEMA_VERSION = 1;

export const LEADERBOARD_BOARD_CACHE_IDB_NAME = 'kiosk-leader-order-board-cache';
export const LEADERBOARD_BOARD_CACHE_IDB_STORE = 'boardSnapshots';

/** 鮮度許容（現ポーリング間隔と整合） */
export const LEADERBOARD_BOARD_CACHE_MAX_AGE_MS = LEADER_BOARD_SCHEDULE_REFETCH_MS;

export const LEADERBOARD_BOARD_CACHE_SYNC_WARNING =
  '一覧の更新に失敗しました。表示は前回保存分です。';

export function isLeaderboardBoardTerminalCacheEnabled(): boolean {
  const raw = import.meta.env.VITE_KIOSK_LEADERBOARD_TERMINAL_CACHE_ENABLED;
  if (raw === undefined || raw === '') return true;
  return raw !== 'false' && raw !== '0';
}

/** Phase 2 SWR 表示（省略時 true・端末キャッシュ無効時は常に false） */
export function isLeaderboardBoardTerminalCachePhase2SwrEnabled(): boolean {
  if (!isLeaderboardBoardTerminalCacheEnabled()) return false;
  const raw = import.meta.env.VITE_KIOSK_LEADERBOARD_TERMINAL_CACHE_PHASE2_SWR;
  if (raw === undefined || raw === '') return true;
  return raw !== 'false' && raw !== '0';
}

/** 登録製番 OR を無 `q` 完走 board へクライアントフィルタ（省略時 true） */
export function isLeaderboardSeibanOrClientFilterEnabled(): boolean {
  const raw = import.meta.env.VITE_KIOSK_LEADERBOARD_SEIBAN_OR_CLIENT_FILTER;
  if (raw === undefined || raw === '') return true;
  return raw !== 'false' && raw !== '0';
}
