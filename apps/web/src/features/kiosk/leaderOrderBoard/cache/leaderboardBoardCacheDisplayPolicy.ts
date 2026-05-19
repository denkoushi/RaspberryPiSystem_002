import { isLeaderboardBoardCacheWithinMaxAge } from './leaderboardBoardCacheRecord';

import type { PersistedLeaderboardBoardCacheRecord } from './leaderboardBoardCacheRecord';
import type { ProductionScheduleLeaderboardBoardResponse } from '../../../../api/client';

export type LeaderboardBoardCacheDisplayInput = {
  terminalCacheEnabled: boolean;
  hydratedRecord: PersistedLeaderboardBoardCacheRecord | null;
  cacheLoadSettled: boolean;
  networkDisplayBoard: ProductionScheduleLeaderboardBoardResponse | undefined;
  networkInitialLoading: boolean;
  suppressPlaceholderShell: boolean;
  nowMs: number;
  maxAgeMs: number;
};

/**
 * ネットワーク未就绪時に端末キャッシュを表示してよいか。
 * ネットワーク側に displayBoard がある場合は常にネットワーク優先（bootstrap のみ）。
 */
export function shouldShowLeaderboardBoardTerminalCache(
  input: LeaderboardBoardCacheDisplayInput
): boolean {
  if (!input.terminalCacheEnabled) return false;
  if (!input.cacheLoadSettled) return false;
  if (input.hydratedRecord == null) return false;
  if (
    !isLeaderboardBoardCacheWithinMaxAge(
      input.hydratedRecord.savedAt,
      input.nowMs,
      input.maxAgeMs
    )
  ) {
    return false;
  }
  if (input.suppressPlaceholderShell && input.networkDisplayBoard == null) return false;
  if (input.networkDisplayBoard != null && input.networkDisplayBoard.rows.length > 0) {
    return false;
  }
  if (input.networkInitialLoading && input.hydratedRecord.board.rows.length > 0) {
    return true;
  }
  return (
    input.networkDisplayBoard == null &&
    input.hydratedRecord.board.rows.length > 0 &&
    !input.suppressPlaceholderShell
  );
}

export function pickLeaderboardBoardForCompositeDisplay(input: {
  networkDisplayBoard: ProductionScheduleLeaderboardBoardResponse | undefined;
  showTerminalCache: boolean;
  hydratedRecord: PersistedLeaderboardBoardCacheRecord | null;
}): ProductionScheduleLeaderboardBoardResponse | undefined {
  if (input.showTerminalCache && input.hydratedRecord != null) {
    return input.hydratedRecord.board;
  }
  return input.networkDisplayBoard;
}
