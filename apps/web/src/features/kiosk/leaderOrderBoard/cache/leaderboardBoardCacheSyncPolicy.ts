import { isLeaderboardBoardCacheWriteOnMutationEnabled } from './leaderboardBoardCacheConstants';
import { isCompleteLeaderboardBoardSnapshot } from './leaderboardBoardCacheRecord';

import type { ProductionScheduleLeaderboardBoardResponse } from '../../../../api/client';

export type ScheduledCachePersistDecision =
  | { action: 'skip'; reason: string }
  | { action: 'put'; board: ProductionScheduleLeaderboardBoardResponse };

/**
 * 120秒ポーリング完走時のみ IDB へ保存する（mutation 経路は別ポリシーで抑止）。
 * serverWins でも purge せずサーバ正本で置換 put する。
 */
export function resolveScheduledCachePersist(input: {
  networkBoardComplete: boolean;
  networkDisplayBoard: ProductionScheduleLeaderboardBoardResponse | undefined;
}): ScheduledCachePersistDecision {
  if (!input.networkBoardComplete) {
    return { action: 'skip', reason: 'network board incomplete' };
  }
  if (input.networkDisplayBoard == null) {
    return { action: 'skip', reason: 'no network board' };
  }
  if (!isCompleteLeaderboardBoardSnapshot(input.networkDisplayBoard)) {
    return { action: 'skip', reason: 'network board not a complete snapshot' };
  }
  return { action: 'put', board: input.networkDisplayBoard };
}

/** ユーザー操作成功時に IDB を即時ミラーするか（既定 false = 120秒同期のみ） */
export function shouldMirrorLeaderboardMutationToCache(): boolean {
  return isLeaderboardBoardCacheWriteOnMutationEnabled();
}
