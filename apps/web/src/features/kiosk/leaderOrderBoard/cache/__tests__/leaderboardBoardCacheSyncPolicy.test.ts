import { describe, expect, it } from 'vitest';

import {
  resolveScheduledCachePersist,
  shouldMirrorLeaderboardMutationToCache
} from '../leaderboardBoardCacheSyncPolicy';

import type { ProductionScheduleLeaderboardBoardResponse } from '../../../../../api/client';

function completeBoard(rowId = 'r1'): ProductionScheduleLeaderboardBoardResponse {
  return {
    page: 1,
    pageSize: 80,
    total: 1,
    rows: [{ id: rowId }],
    resources: [{ resourceCd: '1', hasMore: false, total: 1, pageSize: 80 }]
  } as ProductionScheduleLeaderboardBoardResponse;
}

describe('leaderboardBoardCacheSyncPolicy', () => {
  it('network 未完走時は put しない', () => {
    expect(
      resolveScheduledCachePersist({
        networkBoardComplete: false,
        networkDisplayBoard: completeBoard()
      })
    ).toEqual({ action: 'skip', reason: 'network board incomplete' });
  });

  it('network 完走時はサーバ board を put 対象にする', () => {
    const board = completeBoard('new');
    expect(
      resolveScheduledCachePersist({
        networkBoardComplete: true,
        networkDisplayBoard: board
      })
    ).toEqual({ action: 'put', board });
  });

  it('mutation ミラーは既定で無効', () => {
    expect(shouldMirrorLeaderboardMutationToCache()).toBe(false);
  });
});
