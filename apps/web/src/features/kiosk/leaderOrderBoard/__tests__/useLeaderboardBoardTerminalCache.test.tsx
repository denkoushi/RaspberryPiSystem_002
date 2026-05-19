import { renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { buildLeaderboardBoardCacheRecord } from '../cache/leaderboardBoardCacheRecord';
import { createEmptyAccumulatedLeaderboardDecorations } from '../mergeLeaderboardBoardWithDecorations';
import { useLeaderboardBoardTerminalCache } from '../useLeaderboardBoardTerminalCache';

import type { ProductionScheduleLeaderboardBoardResponse } from '../../../../api/client';
import type { LeaderboardBoardCacheStore } from '../cache/leaderboardBoardCacheStore.port';

function board(ids: string[]): ProductionScheduleLeaderboardBoardResponse {
  return {
    page: 1,
    pageSize: 80,
    total: ids.length,
    rows: ids.map((id) => ({ id })) as ProductionScheduleLeaderboardBoardResponse['rows'],
    resources: [{ resourceCd: '1', hasMore: false, total: ids.length, pageSize: 80 }]
  };
}

describe('useLeaderboardBoardTerminalCache', () => {
  it('hydrate 後 loading 中はキャッシュ board を表示する', async () => {
    const cached = buildLeaderboardBoardCacheRecord({
      cacheKey: 'site\u0001params',
      siteKey: 'site',
      paramsKey: 'params',
      board: board(['cached-1']),
      decorations: createEmptyAccumulatedLeaderboardDecorations()
    })!;

    const store: LeaderboardBoardCacheStore = {
      get: vi.fn().mockResolvedValue(cached),
      put: vi.fn().mockResolvedValue(undefined),
      delete: vi.fn().mockResolvedValue(undefined)
    };

    const { result } = renderHook(() =>
      useLeaderboardBoardTerminalCache({
        siteKey: 'site',
        paramsKey: 'params',
        scheduleEnabled: true,
        networkDisplayBoard: undefined,
        networkSyncToken: 'sync-1',
        networkInitialLoading: true,
        networkIsFetching: false,
        networkIsError: false,
        suppressPlaceholderShell: false,
        accumulatedDecorations: createEmptyAccumulatedLeaderboardDecorations(),
        networkBoardComplete: false,
        store
      })
    );

    await waitFor(() => {
      expect(result.current.displayBoard?.rows[0]?.id).toBe('cached-1');
      expect(result.current.isShowingCachedData).toBe(true);
    });
  });

  it('network 完走版が cache と不一致なら purge する', async () => {
    const cached = buildLeaderboardBoardCacheRecord({
      cacheKey: 'site\u0001params',
      siteKey: 'site',
      paramsKey: 'params',
      board: board(['old']),
      decorations: createEmptyAccumulatedLeaderboardDecorations()
    })!;

    const store: LeaderboardBoardCacheStore = {
      get: vi.fn().mockResolvedValue(cached),
      put: vi.fn().mockResolvedValue(undefined),
      delete: vi.fn().mockResolvedValue(undefined)
    };

    const { result, rerender } = renderHook(
      (props: { network: ProductionScheduleLeaderboardBoardResponse | undefined; complete: boolean }) =>
        useLeaderboardBoardTerminalCache({
          siteKey: 'site',
          paramsKey: 'params',
          scheduleEnabled: true,
          networkDisplayBoard: props.network,
          networkSyncToken: props.complete ? 'sync-complete' : 'sync-init',
          networkInitialLoading: false,
          networkIsFetching: false,
          networkIsError: false,
          suppressPlaceholderShell: false,
          accumulatedDecorations: createEmptyAccumulatedLeaderboardDecorations(),
          networkBoardComplete: props.complete,
          store
        }),
      { initialProps: { network: undefined as ProductionScheduleLeaderboardBoardResponse | undefined, complete: false } }
    );

    await waitFor(() => {
      expect(result.current.displayBoard?.rows[0]?.id).toBe('old');
    });

    rerender({ network: board(['new']), complete: true });

    await waitFor(() => {
      expect(store.delete).toHaveBeenCalledWith('site\u0001params');
      expect(store.put).not.toHaveBeenCalled();
    });
  });

  it('network エラー時は cacheSyncWarning を出す', async () => {
    const cached = buildLeaderboardBoardCacheRecord({
      cacheKey: 'site\u0001params',
      siteKey: 'site',
      paramsKey: 'params',
      board: board(['c1']),
      decorations: createEmptyAccumulatedLeaderboardDecorations()
    })!;

    const store: LeaderboardBoardCacheStore = {
      get: vi.fn().mockResolvedValue(cached),
      put: vi.fn(),
      delete: vi.fn()
    };

    const { result } = renderHook(() =>
      useLeaderboardBoardTerminalCache({
        siteKey: 'site',
        paramsKey: 'params',
        scheduleEnabled: true,
        networkDisplayBoard: undefined,
        networkSyncToken: 'sync-error',
        networkInitialLoading: false,
        networkIsFetching: false,
        networkIsError: true,
        suppressPlaceholderShell: false,
        accumulatedDecorations: createEmptyAccumulatedLeaderboardDecorations(),
        networkBoardComplete: false,
        store
      })
    );

    await waitFor(() => {
      expect(result.current.cacheSyncWarning).toContain('前回保存分');
    });
  });

  it('maxAge を超えたキャッシュは bootstrap 表示しない', async () => {
    const oldSavedAt = Date.now() - 120_001;
    const cached = buildLeaderboardBoardCacheRecord({
      cacheKey: 'site\u0001params',
      siteKey: 'site',
      paramsKey: 'params',
      board: board(['stale']),
      decorations: createEmptyAccumulatedLeaderboardDecorations(),
      savedAt: oldSavedAt
    })!;

    const store: LeaderboardBoardCacheStore = {
      get: vi.fn().mockResolvedValue(cached),
      put: vi.fn(),
      delete: vi.fn()
    };

    const { result } = renderHook(() =>
      useLeaderboardBoardTerminalCache({
        siteKey: 'site',
        paramsKey: 'params',
        scheduleEnabled: true,
        networkDisplayBoard: undefined,
        networkSyncToken: 'sync-stale',
        networkInitialLoading: true,
        networkIsFetching: false,
        networkIsError: false,
        suppressPlaceholderShell: false,
        accumulatedDecorations: createEmptyAccumulatedLeaderboardDecorations(),
        networkBoardComplete: false,
        store
      })
    );

    await waitFor(() => {
      expect(result.current.displayBoard).toBeUndefined();
      expect(result.current.isShowingCachedData).toBe(false);
    });
  });

  it('applyMutationPatch で IDB put する', async () => {
    const cached = buildLeaderboardBoardCacheRecord({
      cacheKey: 'site\u0001params',
      siteKey: 'site',
      paramsKey: 'params',
      board: board(['r1']),
      decorations: createEmptyAccumulatedLeaderboardDecorations()
    })!;
    cached.board.rows[0] = {
      ...cached.board.rows[0]!,
      processingOrder: 1
    } as ProductionScheduleLeaderboardBoardResponse['rows'][number];

    const store: LeaderboardBoardCacheStore = {
      get: vi.fn().mockResolvedValue(cached),
      put: vi.fn().mockResolvedValue(undefined),
      delete: vi.fn()
    };

    const { result } = renderHook(() =>
      useLeaderboardBoardTerminalCache({
        siteKey: 'site',
        paramsKey: 'params',
        scheduleEnabled: true,
        networkDisplayBoard: undefined,
        networkSyncToken: 'sync-patch',
        networkInitialLoading: false,
        networkIsFetching: false,
        networkIsError: false,
        suppressPlaceholderShell: false,
        accumulatedDecorations: createEmptyAccumulatedLeaderboardDecorations(),
        networkBoardComplete: false,
        store
      })
    );

    await waitFor(() => {
      expect(result.current.displayBoard).toBeDefined();
    });

    result.current.applyMutationPatch({
      kind: 'order',
      rowId: 'r1',
      processingOrder: 9
    });

    await waitFor(() => {
      expect(store.put).toHaveBeenCalled();
      expect(result.current.displayBoard?.rows[0]?.processingOrder).toBe(9);
    });
  });
});
