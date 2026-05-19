import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { defaultLeaderboardBoardCacheStore } from './cache/indexedDbLeaderboardBoardCacheStore';
import {
  LEADERBOARD_BOARD_CACHE_MAX_AGE_MS,
  LEADERBOARD_BOARD_CACHE_SYNC_WARNING,
  isLeaderboardBoardTerminalCacheEnabled,
  isLeaderboardBoardTerminalCachePhase2SwrEnabled
} from './cache/leaderboardBoardCacheConstants';
import {
  pickLeaderboardBoardForCompositeDisplay,
  shouldShowLeaderboardBoardTerminalCache
} from './cache/leaderboardBoardCacheDisplayPolicy';
import { buildLeaderboardBoardCacheKey } from './cache/leaderboardBoardCacheKey';
import {
  patchLeaderboardBoardCacheRecord,
  type LeaderboardBoardCacheMutation
} from './cache/leaderboardBoardCachePatchPolicy';
import {
  fingerprintLeaderboardBoardContent,
  shouldSkipCachePut
} from './cache/leaderboardBoardCachePersistPolicy';
import { reconcileLeaderboardBoardCacheWithServer } from './cache/leaderboardBoardCacheReconcilePolicy';
import {
  buildLeaderboardBoardCacheRecord,
  deserializeAccumulatedDecorations,
  isCompleteLeaderboardBoardSnapshot,
  isLeaderboardBoardCacheWithinMaxAge,
  type PersistedLeaderboardBoardCacheRecord
} from './cache/leaderboardBoardCacheRecord';
import { resolveLeaderboardBoardDisplaySource } from './cache/leaderboardBoardSwrDisplayPolicy';

import type { LeaderboardBoardCacheStore } from './cache/leaderboardBoardCacheStore.port';
import type { AccumulatedLeaderboardDecorations } from './mergeLeaderboardBoardWithDecorations';
import type { ProductionScheduleLeaderboardBoardResponse } from '../../../api/client';

export type { LeaderboardBoardCacheMutation };

export type UseLeaderboardBoardTerminalCacheOptions = {
  siteKey: string;
  paramsKey: string;
  scheduleEnabled: boolean;
  networkDisplayBoard: ProductionScheduleLeaderboardBoardResponse | undefined;
  networkSyncToken: string;
  networkInitialLoading: boolean;
  networkIsFetching: boolean;
  networkIsError: boolean;
  suppressPlaceholderShell: boolean;
  accumulatedDecorations: AccumulatedLeaderboardDecorations;
  /** ネットワーク側 board が continue 完走済み */
  networkBoardComplete: boolean;
  store?: LeaderboardBoardCacheStore;
};

export type UseLeaderboardBoardTerminalCacheResult = {
  terminalCacheEnabled: boolean;
  phase2SwrEnabled: boolean;
  displayBoard: ProductionScheduleLeaderboardBoardResponse | undefined;
  displayDecorations: AccumulatedLeaderboardDecorations;
  isShowingCachedData: boolean;
  cacheSyncWarning: string | null;
  /** reconcile 不一致時に呼ぶ（snapshotExpired 等） */
  purgeCache: () => void;
  applyMutationPatch: (mutation: LeaderboardBoardCacheMutation) => void;
};

const EMPTY_DECORATIONS: AccumulatedLeaderboardDecorations = {
  rowDecorationsById: new Map(),
  leaderboardFooterChipsByPartKey: {}
};

export function useLeaderboardBoardTerminalCache(
  options: UseLeaderboardBoardTerminalCacheOptions
): UseLeaderboardBoardTerminalCacheResult {
  const {
    siteKey,
    paramsKey,
    scheduleEnabled,
    networkDisplayBoard,
    networkSyncToken,
    networkInitialLoading,
    networkIsFetching,
    networkIsError,
    suppressPlaceholderShell,
    accumulatedDecorations,
    networkBoardComplete,
    store = defaultLeaderboardBoardCacheStore
  } = options;

  const terminalCacheEnabled = isLeaderboardBoardTerminalCacheEnabled();
  const phase2SwrEnabled = isLeaderboardBoardTerminalCachePhase2SwrEnabled();
  const cacheKey = buildLeaderboardBoardCacheKey(siteKey, paramsKey);

  const [hydratedRecord, setHydratedRecord] = useState<PersistedLeaderboardBoardCacheRecord | null>(null);
  const [cacheLoadSettled, setCacheLoadSettled] = useState(false);
  const [cacheSyncWarning, setCacheSyncWarning] = useState<string | null>(null);
  const lastContentFingerprintRef = useRef<string | null>(null);
  const loadGenerationRef = useRef(0);
  const skippedNetworkSyncTokenRef = useRef<string | null>(null);

  const purgeCache = useCallback(() => {
    if (!terminalCacheEnabled || cacheKey.length === 0) return;
    void store.delete(cacheKey);
    setHydratedRecord(null);
    lastContentFingerprintRef.current = null;
  }, [cacheKey, store, terminalCacheEnabled]);

  useEffect(() => {
    if (!terminalCacheEnabled || !scheduleEnabled || cacheKey.length === 0) {
      setHydratedRecord(null);
      setCacheLoadSettled(true);
      return;
    }

    const gen = ++loadGenerationRef.current;
    setCacheLoadSettled(false);
    setCacheSyncWarning(null);

    void (async () => {
      const record = await store.get(cacheKey);
      if (gen !== loadGenerationRef.current) return;
      if (record != null && record.paramsKey !== paramsKey) {
        setHydratedRecord(null);
        lastContentFingerprintRef.current = null;
      } else {
        setHydratedRecord(record);
        lastContentFingerprintRef.current =
          record != null ? fingerprintLeaderboardBoardContent(record.board) : null;
      }
      setCacheLoadSettled(true);
    })();
  }, [cacheKey, paramsKey, scheduleEnabled, store, terminalCacheEnabled]);

  useEffect(() => {
    if (!terminalCacheEnabled || !scheduleEnabled) return;
    if (networkIsError && hydratedRecord != null) {
      setCacheSyncWarning(LEADERBOARD_BOARD_CACHE_SYNC_WARNING);
    } else if (!networkIsError) {
      setCacheSyncWarning(null);
    }
  }, [hydratedRecord, networkIsError, scheduleEnabled, terminalCacheEnabled]);

  useEffect(() => {
    if (!terminalCacheEnabled || !scheduleEnabled) return;
    if (!networkBoardComplete || networkDisplayBoard == null) return;
    if (!isCompleteLeaderboardBoardSnapshot(networkDisplayBoard)) return;

    if (hydratedRecord != null) {
      const reconcile = reconcileLeaderboardBoardCacheWithServer(
        hydratedRecord.board,
        networkDisplayBoard
      );
      if (reconcile.kind === 'serverWins') {
        skippedNetworkSyncTokenRef.current = networkSyncToken;
        purgeCache();
        return;
      }
    }

    const contentFingerprint = fingerprintLeaderboardBoardContent(networkDisplayBoard);
    if (skippedNetworkSyncTokenRef.current === networkSyncToken) return;
    if (
      shouldSkipCachePut({
        lastContentFingerprint: lastContentFingerprintRef.current,
        nextContentFingerprint: contentFingerprint
      })
    ) {
      return;
    }

    const record = buildLeaderboardBoardCacheRecord({
      cacheKey,
      siteKey,
      paramsKey,
      board: networkDisplayBoard,
      decorations: accumulatedDecorations
    });
    if (record == null || cacheKey.length === 0) return;

    lastContentFingerprintRef.current = contentFingerprint;
    void store.put(record).then(() => {
      setHydratedRecord(record);
    });
  }, [
    accumulatedDecorations,
    cacheKey,
    hydratedRecord,
    networkBoardComplete,
    networkDisplayBoard,
    networkSyncToken,
    paramsKey,
    purgeCache,
    scheduleEnabled,
    siteKey,
    store,
    terminalCacheEnabled
  ]);

  const applyMutationPatch = useCallback(
    (mutation: LeaderboardBoardCacheMutation) => {
      if (!terminalCacheEnabled || !scheduleEnabled || cacheKey.length === 0) return;
      setHydratedRecord((prev) => {
        if (prev == null || prev.paramsKey !== paramsKey) return prev;
        const next = patchLeaderboardBoardCacheRecord(prev, mutation);
        lastContentFingerprintRef.current = fingerprintLeaderboardBoardContent(next.board);
        void store.put(next);
        return next;
      });
    },
    [cacheKey, paramsKey, scheduleEnabled, store, terminalCacheEnabled]
  );

  const phase1Display = useMemo(() => {
    const showTerminalCache = shouldShowLeaderboardBoardTerminalCache({
      terminalCacheEnabled,
      hydratedRecord,
      cacheLoadSettled,
      networkDisplayBoard,
      networkInitialLoading,
      suppressPlaceholderShell,
      nowMs: Date.now(),
      maxAgeMs: LEADERBOARD_BOARD_CACHE_MAX_AGE_MS
    });
    const displayBoard = pickLeaderboardBoardForCompositeDisplay({
      networkDisplayBoard,
      showTerminalCache,
      hydratedRecord
    });
    const displayDecorations =
      showTerminalCache && hydratedRecord != null
        ? deserializeAccumulatedDecorations(hydratedRecord.decorations)
        : accumulatedDecorations;
    const isShowingCachedData =
      showTerminalCache &&
      hydratedRecord != null &&
      isLeaderboardBoardCacheWithinMaxAge(
        hydratedRecord.savedAt,
        Date.now(),
        LEADERBOARD_BOARD_CACHE_MAX_AGE_MS
      );
    return { displayBoard, displayDecorations, isShowingCachedData };
  }, [
    accumulatedDecorations,
    cacheLoadSettled,
    hydratedRecord,
    networkDisplayBoard,
    networkInitialLoading,
    suppressPlaceholderShell,
    terminalCacheEnabled
  ]);

  const phase2Display = useMemo(
    () =>
      resolveLeaderboardBoardDisplaySource({
        terminalCacheEnabled,
        phase2SwrEnabled,
        hydratedRecord,
        cacheLoadSettled,
        paramsKey,
        networkDisplayBoard,
        networkBoardComplete,
        networkInitialLoading,
        networkIsFetching,
        suppressPlaceholderShell,
        accumulatedDecorations,
        nowMs: Date.now(),
        maxAgeMs: LEADERBOARD_BOARD_CACHE_MAX_AGE_MS
      }),
    [
      accumulatedDecorations,
      cacheLoadSettled,
      hydratedRecord,
      networkBoardComplete,
      networkDisplayBoard,
      networkInitialLoading,
      networkIsFetching,
      paramsKey,
      phase2SwrEnabled,
      suppressPlaceholderShell,
      terminalCacheEnabled
    ]
  );

  const { displayBoard, displayDecorations, isShowingCachedData } = phase2SwrEnabled
    ? {
        displayBoard: phase2Display.displayBoard,
        displayDecorations: phase2Display.displayDecorations,
        isShowingCachedData: phase2Display.isShowingCachedData
      }
    : phase1Display;

  return {
    terminalCacheEnabled,
    phase2SwrEnabled,
    displayBoard,
    displayDecorations,
    isShowingCachedData,
    cacheSyncWarning,
    purgeCache,
    applyMutationPatch
  };
}

export { EMPTY_DECORATIONS };
