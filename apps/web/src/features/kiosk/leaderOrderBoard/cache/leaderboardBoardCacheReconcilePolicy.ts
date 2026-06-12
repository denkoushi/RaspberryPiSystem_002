import { fingerprintLeaderboardBoardContent } from './leaderboardBoardCachePersistPolicy';
import { fingerprintLeaderboardBoardRowIds } from './leaderboardBoardCacheRecord';

import type { ProductionScheduleLeaderboardBoardResponse } from '../../../../api/client';

export type LeaderboardBoardCacheReconcileResult =
  | { kind: 'aligned' }
  | { kind: 'serverWins'; reason: string };

/**
 * キャッシュとサーバ完走版の id 列・件数が同値か。
 * 不一致時は常にサーバ正（Phase 1 要件）。
 */
export function reconcileLeaderboardBoardCacheWithServer(
  cached: ProductionScheduleLeaderboardBoardResponse,
  server: ProductionScheduleLeaderboardBoardResponse
): LeaderboardBoardCacheReconcileResult {
  if (cached.total !== server.total) {
    return { kind: 'serverWins', reason: 'total mismatch' };
  }
  if (cached.rows.length !== server.rows.length) {
    return { kind: 'serverWins', reason: 'row count mismatch' };
  }
  if (fingerprintLeaderboardBoardRowIds(cached) !== fingerprintLeaderboardBoardRowIds(server)) {
    return { kind: 'serverWins', reason: 'row id sequence mismatch' };
  }
  if (fingerprintLeaderboardBoardContent(cached) !== fingerprintLeaderboardBoardContent(server)) {
    return { kind: 'serverWins', reason: 'board content mismatch' };
  }
  if (cached.resources.length !== server.resources.length) {
    return { kind: 'serverWins', reason: 'resources length mismatch' };
  }
  for (let i = 0; i < cached.resources.length; i += 1) {
    const c = cached.resources[i]!;
    const s = server.resources[i]!;
    if (c.resourceCd !== s.resourceCd) {
      return { kind: 'serverWins', reason: 'resourceCd mismatch' };
    }
    if (c.total !== s.total) {
      return { kind: 'serverWins', reason: 'resource total mismatch' };
    }
    if (c.hasMore !== s.hasMore) {
      return { kind: 'serverWins', reason: 'hasMore mismatch' };
    }
  }
  return { kind: 'aligned' };
}
