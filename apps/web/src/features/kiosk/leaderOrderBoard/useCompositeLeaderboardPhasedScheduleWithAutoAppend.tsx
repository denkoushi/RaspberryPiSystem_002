import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';

import {
  postKioskProductionScheduleLeaderboardBoardContinue,
  type KioskProductionScheduleLeaderboardBoardQueryParams,
  type ProductionScheduleLeaderboardBoardResponse,
  type ProductionScheduleListResponse
} from '../../../api/client';
import { useKioskProductionScheduleLeaderboardBoard } from '../../../api/hooks';

import { buildLeaderboardBoardContinuePayload } from './buildLeaderboardBoardContinuePayload';
import { normalizeLeaderboardSeibanOrTokens } from './cache/filterLeaderboardBoardBySeibanOr';
import { isLeaderboardSeibanOrClientFilterEnabled } from './cache/leaderboardBoardCacheConstants';
import { resolveDisplayBoardMutationUpdate } from './cache/leaderboardBoardDisplayMutationCoordinator';
import {
  buildLeaderboardBoardLegacyFetchParams,
  buildLeaderboardBoardBaseFetchParams,
  type LeaderboardBoardPhasedBaseFetchParams
} from './cache/leaderboardBoardFetchParams';
import {
  isLeaderboardBoardDataSyncing,
  isLeaderboardDecorationSyncing
} from './cache/leaderboardBoardInteractionLockPolicy';
import { resolveScopedLeaderboardAppendOverride } from './leaderboardBoardAppendOverrideScopePolicy';
import {
  resolveLeaderboardAppendLoopStartBoard,
  shouldBeginLeaderboardAppendSession
} from './leaderboardBoardAppendSessionPolicy';
import {
  fingerprintLeaderboardBoardShell,
  isLeaderboardScheduleInitialLoading,
  pickLeaderboardBoardForDisplay,
  resolveNetworkLeaderboardBoardPagingComplete
} from './leaderboardBoardDisplayPolicy';
import {
  isLeaderboardShellReadyForAppend,
  resolveLeaderboardShellForDisplay,
  shouldSuppressLeaderboardShellPlaceholder
} from './leaderboardBoardShellFreshnessPolicy';
import {
  classifyLeaderboardContinueFailure,
  normalizeLeaderboardContinueFailure
} from './leaderboardContinueErrorPolicy';
import { mergeLeaderboardBoardContinueResponseWithOptionalDelta } from './mergeLeaderboardBoardContinueResponse';
import { mergeLeaderboardBoardWithDecorations } from './mergeLeaderboardBoardWithDecorations';
import {
  useLeaderboardBoardTerminalCache,
  type LeaderboardBoardCacheMutation
} from './useLeaderboardBoardTerminalCache';
import { useLeaderboardDeferredBoardDecorations } from './useLeaderboardDeferredBoardDecorations';
import { useLeaderboardSeibanOrClientFilterOverlay } from './useLeaderboardSeibanOrClientFilterOverlay';

/** 端末無効時に同一参照を返し、下流の再レンダーを安定させる */
const SCHEDULE_QUERY_DISABLED = {
  data: undefined as ProductionScheduleListResponse | undefined,
  isLoading: false,
  isError: false,
  isFetching: false
};

function invalidateLeaderboardDecorationsQueries(queryClient: ReturnType<typeof useQueryClient>) {
  return queryClient.invalidateQueries({
    predicate: (q) =>
      Array.isArray(q.queryKey) &&
      q.queryKey[0] === 'kiosk-production-schedule' &&
      q.queryKey[1] === 'leaderboard-decorations'
  });
}

/**
 * 多資源カードの順位ボード取得（集約 API 1 本＋装飾は `leaderboard-decorations` 後取り）。
 */
export function useCompositeLeaderboardPhasedScheduleWithAutoAppend(options: {
  /** `resourceCds` / `boardResourceCds` を含めない（集約 params で上書きする） */
  leaderboardPhasedBaseParams: LeaderboardBoardPhasedBaseFetchParams;
  /** スロット順など、画面上のカード並び */
  resourceCdsOrdered: string[];
  seibanOrFilters?: string[];
  scheduleEnabled: boolean;
  pauseRefetch: boolean;
  refetchIntervalMs: number;
  macManualOrderV2: boolean;
  activeDeviceScopeKey: string;
  /** 端末キャッシュの工場スコープ */
  siteKey: string;
}): {
  scheduleQuery: {
    data: ProductionScheduleListResponse | undefined;
    isLoading: boolean;
    isError: boolean;
    isFetching: boolean;
  };
  appendError: Error | null;
  /** 旧カード別 feed マウント用（集約化により null） */
  feedMounts: ReactNode;
  /** いずれかのスロットで総件数に未到達のとき真（左ツールスタック等の UI 用） */
  listIncomplete: boolean;
  /** 端末キャッシュ表示中 */
  isShowingCachedData: boolean;
  /** 通信失敗等で前回保存分を表示中 */
  cacheSyncWarning: string | null;
  applyDisplayMutation: (mutation: LeaderboardBoardCacheMutation) => void;
  /** shell/continue/decorations の背景再検証中（SWR キャッシュ維持用） */
  isBackgroundRevalidating: boolean;
  /** 初回 board / refetch / continue / ページング未完走の同期中 */
  isBoardDataSyncing: boolean;
  /** `leaderboard-decorations` POST の同期中 */
  isDecorationSyncing: boolean;
} {
  const {
    leaderboardPhasedBaseParams,
    resourceCdsOrdered,
    seibanOrFilters = [],
    scheduleEnabled,
    pauseRefetch,
    refetchIntervalMs,
    macManualOrderV2,
    activeDeviceScopeKey,
    siteKey
  } = options;

  const clientFilterEnabled = isLeaderboardSeibanOrClientFilterEnabled();
  const seibanTokens = useMemo(
    () => normalizeLeaderboardSeibanOrTokens(seibanOrFilters),
    [seibanOrFilters]
  );
  const seibanOrFiltersKey = useMemo(() => JSON.stringify(seibanOrFilters), [seibanOrFilters]);
  const stableSeibanOrFilters = useMemo(() => JSON.parse(seibanOrFiltersKey) as string[], [seibanOrFiltersKey]);

  const queryClient = useQueryClient();
  const leaderboardPhasedBaseParamsKey = useMemo(
    () => JSON.stringify(leaderboardPhasedBaseParams),
    [leaderboardPhasedBaseParams]
  );
  const resourceCdsOrderedKey = useMemo(() => resourceCdsOrdered.join('\0'), [resourceCdsOrdered]);
  const orderedResourceCds = useMemo(
    () => (resourceCdsOrderedKey.length > 0 ? resourceCdsOrderedKey.split('\0') : []),
    [resourceCdsOrderedKey]
  );

  const boardQueryParams = useMemo((): KioskProductionScheduleLeaderboardBoardQueryParams | undefined => {
    if (!scheduleEnabled || resourceCdsOrderedKey.length === 0) return undefined;
    const baseParams = JSON.parse(leaderboardPhasedBaseParamsKey) as LeaderboardBoardPhasedBaseFetchParams;
    if (clientFilterEnabled) {
      return buildLeaderboardBoardBaseFetchParams({
        phasedBase: baseParams,
        boardResourceCds: orderedResourceCds
      });
    }
    return buildLeaderboardBoardLegacyFetchParams({
      phasedBase: baseParams,
      boardResourceCds: orderedResourceCds,
      seibanOrFilters: stableSeibanOrFilters
    });
  }, [
    clientFilterEnabled,
    leaderboardPhasedBaseParamsKey,
    orderedResourceCds,
    resourceCdsOrderedKey,
    scheduleEnabled,
    stableSeibanOrFilters
  ]);

  const paramsKey = useMemo(
    () => (boardQueryParams != null ? JSON.stringify(boardQueryParams) : ''),
    [boardQueryParams]
  );

  const [appendOverride, setAppendOverride] = useState<ProductionScheduleLeaderboardBoardResponse | null>(null);
  const [appendError, setAppendError] = useState<Error | null>(null);
  const [isAppending, setIsAppending] = useState(false);
  const appendRunIdRef = useRef(0);
  const appendCompleteForParamsKeyRef = useRef<string | null>(null);
  const appendCompleteShellFingerprintRef = useRef<string | null>(null);
  const lastStartedShellFingerprintRef = useRef<string | null>(null);
  const lastRetryNonceStartedRef = useRef(0);
  const [appendRetryGeneration, setAppendRetryGeneration] = useState(0);
  const appendOverrideRef = useRef<ProductionScheduleLeaderboardBoardResponse | null>(null);
  const appendOverrideParamsKeyRef = useRef<string | null>(null);
  const latestParamsKeyRef = useRef<string>(paramsKey);
  const lastCommittedParamsKeyRef = useRef<string | null>(null);

  latestParamsKeyRef.current = paramsKey;

  useEffect(() => {
    appendOverrideRef.current = appendOverride;
  }, [appendOverride]);

  useEffect(() => {
    appendCompleteForParamsKeyRef.current = null;
    appendCompleteShellFingerprintRef.current = null;
    lastStartedShellFingerprintRef.current = null;
    lastRetryNonceStartedRef.current = 0;
    setAppendRetryGeneration(0);
    setAppendOverride(null);
    appendOverrideParamsKeyRef.current = null;
    setAppendError(null);
  }, [paramsKey]);

  const boardQuery = useKioskProductionScheduleLeaderboardBoard(boardQueryParams, {
    enabled: scheduleEnabled && resourceCdsOrdered.length > 0,
    pauseRefetch,
    refetchIntervalMs
  });

  useEffect(() => {
    if (boardQuery.isSuccess && !boardQuery.isPlaceholderData) {
      lastCommittedParamsKeyRef.current = paramsKey;
    }
  }, [boardQuery.isPlaceholderData, boardQuery.isSuccess, paramsKey]);

  const suppressPlaceholderShell = shouldSuppressLeaderboardShellPlaceholder({
    paramsKey,
    isPlaceholderData: boardQuery.isPlaceholderData,
    lastCommittedParamsKey: lastCommittedParamsKeyRef.current
  });

  const resolvedShell = resolveLeaderboardShellForDisplay(boardQuery.data, suppressPlaceholderShell);

  const shellFingerprint = useMemo(
    () => fingerprintLeaderboardBoardShell(resolvedShell),
    [resolvedShell]
  );

  const scopedAppendOverride = resolveScopedLeaderboardAppendOverride({
    paramsKey,
    overrideParamsKey: appendOverrideParamsKeyRef.current,
    override: appendOverrideRef.current
  });
  const networkDisplayBoard = pickLeaderboardBoardForDisplay(resolvedShell, scopedAppendOverride);

  const boardNetworkSyncToken = useMemo(() => {
    if (!boardQuery.isSuccess || boardQuery.isPlaceholderData) {
      return '';
    }
    return `${shellFingerprint}\u0004${boardQuery.dataUpdatedAt}`;
  }, [boardQuery.dataUpdatedAt, boardQuery.isPlaceholderData, boardQuery.isSuccess, shellFingerprint]);

  const {
    accumulatedDecorations,
    isDecorationsFetching,
    decorationsError,
    resetDecorations,
    markDecorationRowsStale
  } = useLeaderboardDeferredBoardDecorations({
    scheduleEnabled,
    paramsKey,
    displayBoard: networkDisplayBoard,
    boardNetworkSyncToken,
    macManualOrderV2,
    activeDeviceScopeKey,
    pauseRefetch
  });

  const networkBoardComplete = useMemo(
    () =>
      resolveNetworkLeaderboardBoardPagingComplete({
        networkDisplayBoard,
        scopedAppendOverride,
        resolvedShell
      }),
    [networkDisplayBoard, resolvedShell, scopedAppendOverride]
  );

  const isBoardDataSyncing = useMemo(
    () =>
      isLeaderboardBoardDataSyncing({
        scheduleEnabled,
        networkBoardComplete,
        networkInitialLoading: boardQuery.isLoading,
        networkIsFetching: boardQuery.isFetching,
        isAppending
      }),
    [
      boardQuery.isFetching,
      boardQuery.isLoading,
      isAppending,
      networkBoardComplete,
      scheduleEnabled
    ]
  );

  const isDecorationSyncing = useMemo(
    () =>
      isLeaderboardDecorationSyncing({
        scheduleEnabled,
        isDecorationsFetching
      }),
    [isDecorationsFetching, scheduleEnabled]
  );

  const isBackgroundRevalidating = useMemo(
    () => isBoardDataSyncing || isDecorationSyncing,
    [isBoardDataSyncing, isDecorationSyncing]
  );

  const {
    displayBoard,
    displayDecorations,
    isShowingCachedData,
    cacheSyncWarning,
    purgeCache,
    applyMutationPatch: applyIdbMutationPatch
  } = useLeaderboardBoardTerminalCache({
    siteKey,
    paramsKey,
    scheduleEnabled,
    networkDisplayBoard,
    networkSyncToken: shellFingerprint,
    networkInitialLoading: boardQuery.isLoading,
    networkIsFetching: boardQuery.isFetching,
    networkIsError: boardQuery.isError,
    suppressPlaceholderShell,
    accumulatedDecorations,
    networkBoardComplete,
    isBackgroundRevalidating
  });

  const resolvedShellRef = useRef(resolvedShell);
  resolvedShellRef.current = resolvedShell;

  const applyDisplayMutation = useCallback(
    (mutation: LeaderboardBoardCacheMutation) => {
      applyIdbMutationPatch(mutation);

      const shell = resolvedShellRef.current;
      const scopedAppend = resolveScopedLeaderboardAppendOverride({
        paramsKey,
        overrideParamsKey: appendOverrideParamsKeyRef.current,
        override: appendOverrideRef.current
      });
      const { nextAppendOverride, staleDecorationRowIds } = resolveDisplayBoardMutationUpdate({
        shell,
        appendOverride: scopedAppend,
        mutation
      });

      if (nextAppendOverride != null) {
        setAppendOverride(nextAppendOverride);
        appendOverrideRef.current = nextAppendOverride;
        appendOverrideParamsKeyRef.current = paramsKey;
      }

      if (staleDecorationRowIds.length > 0) {
        markDecorationRowsStale(staleDecorationRowIds);
      }
    },
    [applyIdbMutationPatch, markDecorationRowsStale, paramsKey]
  );

  const listIncomplete = useMemo(() => {
    if (!displayBoard) return false;
    return displayBoard.resources.some((r) => r.hasMore || (typeof r.nextCursor === 'number' && r.nextCursor < r.total));
  }, [displayBoard]);

  useEffect(() => {
    if (
      !scheduleEnabled ||
      !boardQuery.isSuccess ||
      !isLeaderboardShellReadyForAppend({ suppressPlaceholderShell, shell: resolvedShell }) ||
      !boardQueryParams
    ) {
      return;
    }

    const shell = resolvedShell;
    if (!shell) return;
    const shouldBegin = shouldBeginLeaderboardAppendSession({
      paramsKey,
      appendCompleteForParamsKey: appendCompleteForParamsKeyRef.current,
      appendCompleteShellFingerprint: appendCompleteShellFingerprintRef.current,
      shellFingerprint,
      lastStartedShellFingerprint: lastStartedShellFingerprintRef.current,
      shell,
      appendOverride: appendOverrideRef.current,
      retryNonce: appendRetryGeneration,
      lastRetryNonceStarted: lastRetryNonceStartedRef.current
    });

    if (!shouldBegin) return;

    lastStartedShellFingerprintRef.current = shellFingerprint;
    lastRetryNonceStartedRef.current = appendRetryGeneration;

    const runId = ++appendRunIdRef.current;
    let cancelled = false;

    void (async () => {
      try {
        const runParamsKey = paramsKey;
        let cur = resolveLeaderboardAppendLoopStartBoard(
          shell,
          resolveScopedLeaderboardAppendOverride({
            paramsKey: runParamsKey,
            overrideParamsKey: appendOverrideParamsKeyRef.current,
            override: appendOverrideRef.current
          })
        );
        while (!cancelled && runId === appendRunIdRef.current && cur.resources.some((r) => r.hasMore)) {
          setIsAppending(true);
          setAppendError(null);
          const payload = buildLeaderboardBoardContinuePayload(boardQueryParams, cur);
          const nextRaw = await postKioskProductionScheduleLeaderboardBoardContinue(payload);
          if (nextRaw.snapshotExpired) {
            appendCompleteForParamsKeyRef.current = null;
            appendCompleteShellFingerprintRef.current = null;
            lastStartedShellFingerprintRef.current = null;
            setAppendOverride(null);
            appendOverrideRef.current = null;
            appendOverrideParamsKeyRef.current = null;
            resetDecorations();
            purgeCache();
            await Promise.all([
              queryClient.invalidateQueries({ queryKey: ['kiosk-production-schedule'] }),
              invalidateLeaderboardDecorationsQueries(queryClient)
            ]);
            break;
          }
          const next =
            orderedResourceCds.length > 0
              ? mergeLeaderboardBoardContinueResponseWithOptionalDelta(cur.rows, nextRaw, orderedResourceCds, {
                  processChangeResidualTotal: cur.processChangeResidualTotal,
                  processChangeResidualRows: cur.processChangeResidualRows,
                  processChangeResidualRepresentativeLimit: cur.processChangeResidualRepresentativeLimit
                })
              : nextRaw;
          if (latestParamsKeyRef.current !== runParamsKey) {
            return;
          }
          setAppendOverride(next);
          appendOverrideParamsKeyRef.current = runParamsKey;
          appendOverrideRef.current = next;
          cur = next;
        }
        if (!cancelled && runId === appendRunIdRef.current && !cur.resources.some((r) => r.hasMore)) {
          appendCompleteForParamsKeyRef.current = paramsKey;
          appendCompleteShellFingerprintRef.current = shellFingerprint;
        }
      } catch (e) {
        if (!cancelled && runId === appendRunIdRef.current) {
          const normalized = normalizeLeaderboardContinueFailure(e);
          if (classifyLeaderboardContinueFailure(normalized) === 'terminal') {
            setAppendError(normalized);
          } else {
            setAppendRetryGeneration((n) => n + 1);
          }
        }
      } finally {
        if (runId === appendRunIdRef.current) setIsAppending(false);
      }
    })();

    return () => {
      cancelled = true;
    };
    // boardQuery.data は意図的に除外: refetch 更新で continue を再開すると表示が巻き戻る。
    // shellFingerprint で shell 変化のみ再評価する。
  // eslint-disable-next-line react-hooks/exhaustive-deps -- refetch-stable append session
  }, [
    appendRetryGeneration,
    boardQuery.isSuccess,
    boardQueryParams,
    paramsKey,
    queryClient,
    resetDecorations,
    resolvedShell,
    scheduleEnabled,
    shellFingerprint,
    suppressPlaceholderShell,
    orderedResourceCds,
    purgeCache
  ]);

  const { displayBoardForUi, listIncompleteForUi } = useLeaderboardSeibanOrClientFilterOverlay({
    enabled: clientFilterEnabled,
    seibanOrFilters,
    orderedResourceCds,
    leaderboardPhasedBaseParamsKey,
    displayBoard,
    networkDisplayBoard,
    networkBoardComplete,
    appendRunIdRef,
    setIsAppending
  });

  const scheduleQuery = useMemo(() => {
    if (!scheduleEnabled || resourceCdsOrdered.length === 0) {
      return SCHEDULE_QUERY_DISABLED;
    }

    const boardForSchedule = displayBoardForUi;

    if (!boardForSchedule) {
      const awaitingFreshShellAfterParamsChange =
        suppressPlaceholderShell && scopedAppendOverride == null;
      return {
        data: undefined as ProductionScheduleListResponse | undefined,
        isLoading: boardQuery.isLoading || awaitingFreshShellAfterParamsChange,
        isError: boardQuery.isError,
        isFetching: boardQuery.isFetching || isAppending
      };
    }

    const data = mergeLeaderboardBoardWithDecorations(boardForSchedule, displayDecorations);
    const decorationFailed = decorationsError != null && !isShowingCachedData;

    const awaitingFreshShellAfterParamsChange =
      suppressPlaceholderShell && scopedAppendOverride == null && boardForSchedule.rows.length === 0;

    const hasDisplayableRows = boardForSchedule.rows.length > 0;
    const bootstrapFromCache =
      isShowingCachedData && hasDisplayableRows && seibanTokens.length === 0;

    return {
      data,
      isLoading:
        !bootstrapFromCache &&
        (isLeaderboardScheduleInitialLoading(boardQuery.isLoading, boardForSchedule.rows.length) ||
          awaitingFreshShellAfterParamsChange),
      isError: (boardQuery.isError && !isShowingCachedData) || decorationFailed,
      isFetching: boardQuery.isFetching || isAppending
    };
  }, [
    boardQuery.isError,
    boardQuery.isFetching,
    boardQuery.isLoading,
    decorationsError,
    displayBoardForUi,
    displayDecorations,
    isAppending,
    isShowingCachedData,
    resourceCdsOrdered.length,
    scheduleEnabled,
    scopedAppendOverride,
    seibanTokens.length,
    suppressPlaceholderShell
  ]);

  void macManualOrderV2;
  void activeDeviceScopeKey;

  return {
    scheduleQuery,
    appendError,
    feedMounts: null,
    listIncomplete: listIncompleteForUi ?? listIncomplete,
    isShowingCachedData,
    cacheSyncWarning,
    applyDisplayMutation,
    isBackgroundRevalidating,
    isBoardDataSyncing,
    isDecorationSyncing
  };
}
