import { useCallback, useEffect, useRef, useState } from 'react';

import { defaultLeaderboardBoardCacheStore } from './cache/indexedDbLeaderboardBoardCacheStore';
import {
  LEADERBOARD_BOARD_CACHE_MAX_AGE_MS,
  LEADERBOARD_BOARD_CACHE_SYNC_WARNING,
  isLeaderboardBoardTerminalCacheEnabled
} from './cache/leaderboardBoardCacheConstants';
import {
  pickLeaderboardBoardForCompositeDisplay,
  shouldShowLeaderboardBoardTerminalCache
} from './cache/leaderboardBoardCacheDisplayPolicy';
import { buildLeaderboardBoardCacheKey } from './cache/leaderboardBoardCacheKey';
import { reconcileLeaderboardBoardCacheWithServer } from './cache/leaderboardBoardCacheReconcilePolicy';
import {
  buildLeaderboardBoardCacheRecord,
  deserializeAccumulatedDecorations,
  isCompleteLeaderboardBoardSnapshot,
  isLeaderboardBoardCacheWithinMaxAge,
  type PersistedLeaderboardBoardCacheRecord
} from './cache/leaderboardBoardCacheRecord';

import type { LeaderboardBoardCacheStore } from './cache/leaderboardBoardCacheStore.port';
import type { AccumulatedLeaderboardDecorations } from './mergeLeaderboardBoardWithDecorations';
import type { ProductionScheduleLeaderboardBoardResponse } from '../../../api/client';

export type UseLeaderboardBoardTerminalCacheOptions = {
  siteKey: string;
  paramsKey: string;
  scheduleEnabled: boolean;
  networkDisplayBoard: ProductionScheduleLeaderboardBoardResponse | undefined;
  networkSyncToken: string;
  networkInitialLoading: boolean;
  networkIsError: boolean;
  suppressPlaceholderShell: boolean;
  accumulatedDecorations: AccumulatedLeaderboardDecorations;
  /** ネットワーク側 board が continue 完走済み */
  networkBoardComplete: boolean;
  store?: LeaderboardBoardCacheStore;
};

export type UseLeaderboardBoardTerminalCacheResult = {
  terminalCacheEnabled: boolean;
  displayBoard: ProductionScheduleLeaderboardBoardResponse | undefined;
  displayDecorations: AccumulatedLeaderboardDecorations;
  isShowingCachedData: boolean;
  cacheSyncWarning: string | null;
  /** reconcile 不一致時に呼ぶ（snapshotExpired 等） */
  purgeCache: () => void;
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
    networkIsError,
    suppressPlaceholderShell,
    accumulatedDecorations,
    networkBoardComplete,
    store = defaultLeaderboardBoardCacheStore
  } = options;

  const terminalCacheEnabled = isLeaderboardBoardTerminalCacheEnabled();
  const cacheKey = buildLeaderboardBoardCacheKey(siteKey, paramsKey);

  const [hydratedRecord, setHydratedRecord] = useState<PersistedLeaderboardBoardCacheRecord | null>(null);
  const [cacheLoadSettled, setCacheLoadSettled] = useState(false);
  const [cacheSyncWarning, setCacheSyncWarning] = useState<string | null>(null);
  const lastSavedFingerprintRef = useRef<string | null>(null);
  const loadGenerationRef = useRef(0);
  const skippedNetworkSyncTokenRef = useRef<string | null>(null);

  const purgeCache = useCallback(() => {
    if (!terminalCacheEnabled || cacheKey.length === 0) return;
    void store.delete(cacheKey);
    setHydratedRecord(null);
    lastSavedFingerprintRef.current = null;
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
      } else {
        setHydratedRecord(record);
        lastSavedFingerprintRef.current = record?.rowIdsFingerprint ?? null;
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

    const fingerprint = networkDisplayBoard.rows.map((r) => r.id).join('\u0001');
    if (skippedNetworkSyncTokenRef.current === networkSyncToken) return;
    if (lastSavedFingerprintRef.current === fingerprint) return;

    const record = buildLeaderboardBoardCacheRecord({
      cacheKey,
      siteKey,
      paramsKey,
      board: networkDisplayBoard,
      decorations: accumulatedDecorations
    });
    if (record == null || cacheKey.length === 0) return;

    lastSavedFingerprintRef.current = fingerprint;
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

  return {
    terminalCacheEnabled,
    displayBoard,
    displayDecorations,
    isShowingCachedData,
    cacheSyncWarning,
    purgeCache
  };
}

export { EMPTY_DECORATIONS };
