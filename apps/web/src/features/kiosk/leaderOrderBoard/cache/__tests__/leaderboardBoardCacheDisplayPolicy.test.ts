import { describe, expect, it } from 'vitest';

import { createEmptyAccumulatedLeaderboardDecorations } from '../../mergeLeaderboardBoardWithDecorations';
import {
  pickLeaderboardBoardForCompositeDisplay,
  shouldShowLeaderboardBoardTerminalCache
} from '../leaderboardBoardCacheDisplayPolicy';
import { buildLeaderboardBoardCacheRecord } from '../leaderboardBoardCacheRecord';

import type { ProductionScheduleLeaderboardBoardResponse } from '../../../../../api/client';

function board(rows: string[]): ProductionScheduleLeaderboardBoardResponse {
  return {
    page: 1,
    pageSize: 80,
    total: rows.length,
    rows: rows.map((id) => ({
      id,
      rowData: { FSIGENCD: '1' },
      machineRequiredMinutes: 0,
      laborRequiredMinutes: 0
    })) as ProductionScheduleLeaderboardBoardResponse['rows'],
    resources: [{ resourceCd: '1', hasMore: false, total: rows.length, pageSize: 80 }]
  };
}

describe('leaderboardBoardCacheDisplayPolicy', () => {
  const hydrated = buildLeaderboardBoardCacheRecord({
    cacheKey: 'k',
    siteKey: 's',
    paramsKey: 'p',
    board: board(['c1']),
    decorations: createEmptyAccumulatedLeaderboardDecorations()
  })!;

  it('loading 中かつキャッシュありなら表示', () => {
    expect(
      shouldShowLeaderboardBoardTerminalCache({
        terminalCacheEnabled: true,
        hydratedRecord: hydrated,
        cacheLoadSettled: true,
        networkDisplayBoard: undefined,
        networkInitialLoading: true,
        suppressPlaceholderShell: false,
        nowMs: hydrated.savedAt,
        maxAgeMs: 120_000
      })
    ).toBe(true);
  });

  it('ネットワーク displayBoard があるときはキャッシュ非表示', () => {
    expect(
      shouldShowLeaderboardBoardTerminalCache({
        terminalCacheEnabled: true,
        hydratedRecord: hydrated,
        cacheLoadSettled: true,
        networkDisplayBoard: board(['n1']),
        networkInitialLoading: false,
        suppressPlaceholderShell: false,
        nowMs: hydrated.savedAt,
        maxAgeMs: 120_000
      })
    ).toBe(false);
  });

  it('suppressPlaceholderShell で network 無しは非表示', () => {
    expect(
      shouldShowLeaderboardBoardTerminalCache({
        terminalCacheEnabled: true,
        hydratedRecord: hydrated,
        cacheLoadSettled: true,
        networkDisplayBoard: undefined,
        networkInitialLoading: true,
        suppressPlaceholderShell: true,
        nowMs: hydrated.savedAt,
        maxAgeMs: 120_000
      })
    ).toBe(false);
  });

  it('maxAge を超えたキャッシュは表示しない', () => {
    expect(
      shouldShowLeaderboardBoardTerminalCache({
        terminalCacheEnabled: true,
        hydratedRecord: hydrated,
        cacheLoadSettled: true,
        networkDisplayBoard: undefined,
        networkInitialLoading: true,
        suppressPlaceholderShell: false,
        nowMs: hydrated.savedAt + 120_001,
        maxAgeMs: 120_000
      })
    ).toBe(false);
  });

  it('pickLeaderboardBoardForCompositeDisplay は show 時キャッシュ', () => {
    const picked = pickLeaderboardBoardForCompositeDisplay({
      networkDisplayBoard: undefined,
      showTerminalCache: true,
      hydratedRecord: hydrated
    });
    expect(picked?.rows[0]?.id).toBe('c1');
  });
});
