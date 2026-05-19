import { describe, expect, it } from 'vitest';

import { createEmptyAccumulatedLeaderboardDecorations } from '../../mergeLeaderboardBoardWithDecorations';
import { patchLeaderboardBoardCacheRecord } from '../leaderboardBoardCachePatchPolicy';
import { buildLeaderboardBoardCacheRecord } from '../leaderboardBoardCacheRecord';

import type { ProductionScheduleLeaderboardBoardResponse } from '../../../../../api/client';

function completeBoard(): ProductionScheduleLeaderboardBoardResponse {
  return {
    page: 1,
    pageSize: 80,
    total: 1,
    rows: [
      {
        id: 'r1',
        processingOrder: 1,
        note: null,
        dueDate: null,
        rowData: { progress: '未', FSIGENCD: '1' }
      }
    ],
    resources: [{ resourceCd: '1', hasMore: false, total: 1, pageSize: 80 }]
  } as ProductionScheduleLeaderboardBoardResponse;
}

describe('leaderboardBoardCachePatchPolicy', () => {
  it('order mutation で processingOrder を更新する', () => {
    const base = buildLeaderboardBoardCacheRecord({
      cacheKey: 'k',
      siteKey: 's',
      paramsKey: 'p',
      board: completeBoard(),
      decorations: createEmptyAccumulatedLeaderboardDecorations()
    })!;
    const next = patchLeaderboardBoardCacheRecord(base, {
      kind: 'order',
      rowId: 'r1',
      processingOrder: 5
    });
    expect(next.board.rows[0]?.processingOrder).toBe(5);
    expect(next.savedAt).toBeGreaterThanOrEqual(base.savedAt);
  });
});
