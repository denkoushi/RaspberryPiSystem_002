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
    rows: [
      {
        id: rowId,
        rowData: { FSIGENCD: '1' },
        machineRequiredMinutes: 0,
        laborRequiredMinutes: 0
      }
    ],
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

  it('背景再検証中は cache を優先', () => {
    expect(
      shouldPreferCacheForSwrDisplay({
        cacheDisplayable: true,
        isBackgroundRevalidating: true,
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
      isBackgroundRevalidating: false,
      suppressPlaceholderShell: false,
      accumulatedDecorations: createEmptyAccumulatedLeaderboardDecorations(),
      nowMs: now,
      maxAgeMs: 120_000
    });
    expect(result.displaySource).toBe('network');
    expect(result.displayBoard?.rows[0]?.id).toBe('n1');
  });

  it('fresh network rows がある背景同期中は network を優先する', () => {
    expect(
      shouldPreferCacheForSwrDisplay({
        cacheDisplayable: true,
        isBackgroundRevalidating: true,
        suppressPlaceholderShell: false,
        networkDisplayBoard: completeBoard('n1')
      })
    ).toBe(false);
  });

  it('revalidate 中でも fresh network rows があれば network 表示', () => {
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
      isBackgroundRevalidating: true,
      suppressPlaceholderShell: false,
      accumulatedDecorations: createEmptyAccumulatedLeaderboardDecorations(),
      nowMs: now,
      maxAgeMs: 120_000
    });
    expect(result.displaySource).toBe('network');
    expect(result.displayBoard?.rows[0]?.id).toBe('n1');
    expect(result.isShowingCachedData).toBe(false);
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
