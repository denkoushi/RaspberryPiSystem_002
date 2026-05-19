import { describe, expect, it } from 'vitest';

import { createEmptyAccumulatedLeaderboardDecorations } from '../../mergeLeaderboardBoardWithDecorations';
import { buildLeaderboardBoardCacheRecord } from '../leaderboardBoardCacheRecord';
import {
  isHydratedCacheDisplayable,
  resolveLeaderboardBoardDisplaySource,
  shouldPreferCacheForSwrDisplay
} from '../leaderboardBoardSwrDisplayPolicy';

import type { ProductionScheduleLeaderboardBoardResponse } from '../../../../../api/client';

function completeBoard(rowId = 'c1'): ProductionScheduleLeaderboardBoardResponse {
  return {
    page: 1,
    pageSize: 80,
    total: 1,
    rows: [{ id: rowId }],
    resources: [{ resourceCd: '1', hasMore: false, total: 1, pageSize: 80 }]
  } as ProductionScheduleLeaderboardBoardResponse;
}

describe('leaderboardBoardSwrDisplayPolicy', () => {
  const now = Date.now();
  const hydrated = buildLeaderboardBoardCacheRecord({
    cacheKey: 'k',
    siteKey: 's',
    paramsKey: 'p',
    board: completeBoard(),
    decorations: createEmptyAccumulatedLeaderboardDecorations(),
    savedAt: now
  })!;

  it('paramsKey 変更直後は suppressPlaceholderShell でも cache を優先', () => {
    expect(
      shouldPreferCacheForSwrDisplay({
        cacheDisplayable: true,
        networkBoardComplete: false,
        networkInitialLoading: true,
        networkIsFetching: false,
        suppressPlaceholderShell: true,
        networkDisplayBoard: undefined
      })
    ).toBe(true);
  });

  it('network 完走かつ fetching でないときは network', () => {
    const result = resolveLeaderboardBoardDisplaySource({
      terminalCacheEnabled: true,
      phase2SwrEnabled: true,
      hydratedRecord: hydrated,
      cacheLoadSettled: true,
      paramsKey: 'p',
      networkDisplayBoard: completeBoard('n1'),
      networkBoardComplete: true,
      networkInitialLoading: false,
      networkIsFetching: false,
      suppressPlaceholderShell: false,
      accumulatedDecorations: createEmptyAccumulatedLeaderboardDecorations(),
      nowMs: now,
      maxAgeMs: 120_000
    });
    expect(result.displaySource).toBe('network');
    expect(result.displayBoard?.rows[0]?.id).toBe('n1');
  });

  it('revalidate 中は cache 表示', () => {
    const result = resolveLeaderboardBoardDisplaySource({
      terminalCacheEnabled: true,
      phase2SwrEnabled: true,
      hydratedRecord: hydrated,
      cacheLoadSettled: true,
      paramsKey: 'p',
      networkDisplayBoard: completeBoard('n1'),
      networkBoardComplete: true,
      networkInitialLoading: false,
      networkIsFetching: true,
      suppressPlaceholderShell: false,
      accumulatedDecorations: createEmptyAccumulatedLeaderboardDecorations(),
      nowMs: now,
      maxAgeMs: 120_000
    });
    expect(result.displaySource).toBe('cache');
    expect(result.isShowingCachedData).toBe(true);
  });

  it('isHydratedCacheDisplayable は maxAge 超過で false', () => {
    expect(
      isHydratedCacheDisplayable({
        hydratedRecord: hydrated,
        cacheLoadSettled: true,
        paramsKey: 'p',
        nowMs: now + 120_001,
        maxAgeMs: 120_000
      })
    ).toBe(false);
  });
});
