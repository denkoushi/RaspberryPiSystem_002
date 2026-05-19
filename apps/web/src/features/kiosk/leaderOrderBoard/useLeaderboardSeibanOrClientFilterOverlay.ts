import { useEffect, useMemo, useRef, useState } from 'react';

import {
  getKioskProductionScheduleLeaderboardBoard,
  type KioskProductionScheduleLeaderboardBoardQueryParams,
  type KioskProductionScheduleLeaderboardPhasedQueryParams,
  type ProductionScheduleLeaderboardBoardResponse
} from '../../../api/client';

import {
  filterLeaderboardBoardBySeibanOr,
  normalizeLeaderboardSeibanOrTokens
} from './cache/filterLeaderboardBoardBySeibanOr';
import { reconcileLeaderboardBoardCacheWithServer } from './cache/leaderboardBoardCacheReconcilePolicy';
import { buildLeaderboardBoardReconcileFetchParams } from './cache/leaderboardBoardFetchParams';
import { canDisplayLeaderboardSeibanClientFilter } from './cache/leaderboardBoardSeibanClientFilterPolicy';
import { resolveScopedLeaderboardAppendOverride } from './leaderboardBoardAppendOverrideScopePolicy';
import { runLeaderboardBoardAppendSession } from './leaderboardBoardAppendSessionRunner';

export function useLeaderboardSeibanOrClientFilterOverlay(input: {
  enabled: boolean;
  seibanOrFilters: readonly string[];
  orderedResourceCds: readonly string[];
  leaderboardPhasedBaseParamsKey: string;
  displayBoard: ProductionScheduleLeaderboardBoardResponse | undefined;
  networkDisplayBoard: ProductionScheduleLeaderboardBoardResponse | undefined;
  networkBoardComplete: boolean;
  appendRunIdRef: { current: number };
  setIsAppending: (value: boolean) => void;
}): {
  displayBoardForUi: ProductionScheduleLeaderboardBoardResponse | undefined;
  listIncompleteForUi: boolean | undefined;
} {
  const {
    enabled,
    seibanOrFilters,
    orderedResourceCds,
    leaderboardPhasedBaseParamsKey,
    displayBoard,
    networkDisplayBoard,
    networkBoardComplete,
    appendRunIdRef,
    setIsAppending
  } = input;

  const seibanTokens = useMemo(
    () => normalizeLeaderboardSeibanOrTokens(seibanOrFilters),
    [seibanOrFilters]
  );
  const seibanOrFiltersKey = useMemo(() => JSON.stringify(seibanOrFilters), [seibanOrFilters]);
  const baseBoardRowIdsKey = useMemo(
    () => (networkDisplayBoard != null ? networkDisplayBoard.rows.map((row) => row.id).join('\u0001') : ''),
    [networkDisplayBoard]
  );
  const overlayActive = enabled && seibanTokens.length > 0;

  const [serverVerifiedBoard, setServerVerifiedBoard] =
    useState<ProductionScheduleLeaderboardBoardResponse | null>(null);
  const prevSeibanOrFiltersKeyRef = useRef(seibanOrFiltersKey);
  const reconcileRunIdRef = useRef(0);
  const reconcileAppendOverrideRef = useRef<ProductionScheduleLeaderboardBoardResponse | null>(null);
  const reconcileAppendOverrideParamsKeyRef = useRef<string | null>(null);
  const reconcileLatestParamsKeyRef = useRef('');

  useEffect(() => {
    if (!overlayActive) return;
    setServerVerifiedBoard(null);
    if (prevSeibanOrFiltersKeyRef.current === seibanOrFiltersKey) return;
    prevSeibanOrFiltersKeyRef.current = seibanOrFiltersKey;
    appendRunIdRef.current += 1;
    setIsAppending(false);
  }, [appendRunIdRef, overlayActive, seibanOrFiltersKey, setIsAppending]);

  useEffect(() => {
    if (!overlayActive) return;
    setServerVerifiedBoard(null);
  }, [baseBoardRowIdsKey, overlayActive]);

  const clientFilteredBoard = useMemo(() => {
    if (!overlayActive) return null;
    if (
      !canDisplayLeaderboardSeibanClientFilter({
        seibanOrFilters,
        baseBoard: displayBoard ?? networkDisplayBoard
      })
    ) {
      return null;
    }
    const base = displayBoard ?? networkDisplayBoard;
    if (!base) return null;
    return filterLeaderboardBoardBySeibanOr(base, seibanOrFilters, orderedResourceCds);
  }, [displayBoard, networkDisplayBoard, orderedResourceCds, overlayActive, seibanOrFilters]);

  const displayBoardForUi = useMemo(() => {
    if (!overlayActive) {
      return displayBoard;
    }
    return serverVerifiedBoard ?? clientFilteredBoard ?? displayBoard ?? networkDisplayBoard;
  }, [
    clientFilteredBoard,
    displayBoard,
    networkDisplayBoard,
    overlayActive,
    serverVerifiedBoard
  ]);

  const listIncompleteForUi = useMemo(() => {
    if (!overlayActive || !displayBoardForUi) return undefined;
    return displayBoardForUi.resources.some(
      (r) => r.hasMore || (typeof r.nextCursor === 'number' && r.nextCursor < r.total)
    );
  }, [displayBoardForUi, overlayActive]);

  const reconcileFetchParams = useMemo((): KioskProductionScheduleLeaderboardBoardQueryParams | undefined => {
    if (!overlayActive) return undefined;
    const phasedBase = JSON.parse(
      leaderboardPhasedBaseParamsKey
    ) as KioskProductionScheduleLeaderboardPhasedQueryParams;
    return buildLeaderboardBoardReconcileFetchParams({
      phasedBase,
      boardResourceCds: orderedResourceCds,
      seibanOrFilters
    });
  }, [leaderboardPhasedBaseParamsKey, orderedResourceCds, overlayActive, seibanOrFilters]);

  const reconcileParamsKey = useMemo(
    () => (reconcileFetchParams != null ? JSON.stringify(reconcileFetchParams) : ''),
    [reconcileFetchParams]
  );

  useEffect(() => {
    if (!overlayActive || reconcileParamsKey.length === 0 || !networkBoardComplete || !networkDisplayBoard) {
      return;
    }

    const runId = ++reconcileRunIdRef.current;
    reconcileLatestParamsKeyRef.current = reconcileParamsKey;
    let cancelled = false;

    void (async () => {
      try {
        const params = reconcileFetchParams;
        if (!params) return;

        let serverBoard = await getKioskProductionScheduleLeaderboardBoard(params);
        if (cancelled || runId !== reconcileRunIdRef.current) return;

        if (serverBoard.resources.some((r) => r.hasMore)) {
          reconcileAppendOverrideRef.current = null;
          reconcileAppendOverrideParamsKeyRef.current = null;
          await runLeaderboardBoardAppendSession({
            runId,
            paramsKey: reconcileParamsKey,
            shell: serverBoard,
            boardQueryParams: params,
            orderedResourceCds,
            refs: {
              appendOverrideRef: reconcileAppendOverrideRef,
              appendOverrideParamsKeyRef: reconcileAppendOverrideParamsKeyRef,
              latestParamsKeyRef: reconcileLatestParamsKeyRef
            },
            isRunCurrent: (id) => !cancelled && id === reconcileRunIdRef.current,
            shouldAbort: () => cancelled,
            onAppending: () => {},
            onError: () => {},
            onOverride: () => {},
            onComplete: () => {},
            onSnapshotExpired: async () => {},
            onRetry: () => {}
          });
          if (cancelled || runId !== reconcileRunIdRef.current) return;
          serverBoard =
            reconcileAppendOverrideRef.current ??
            resolveScopedLeaderboardAppendOverride({
              paramsKey: reconcileParamsKey,
              overrideParamsKey: reconcileAppendOverrideParamsKeyRef.current,
              override: reconcileAppendOverrideRef.current
            }) ??
            serverBoard;
        }

        const clientFiltered = filterLeaderboardBoardBySeibanOr(
          networkDisplayBoard,
          seibanOrFilters,
          orderedResourceCds
        );
        if (clientFiltered == null) return;

        const result = reconcileLeaderboardBoardCacheWithServer(clientFiltered, serverBoard);
        if (!cancelled && runId === reconcileRunIdRef.current && result.kind === 'serverWins') {
          setServerVerifiedBoard(serverBoard);
        }
      } catch {
        // reconcile 失敗時はクライアントフィルタ表示を維持
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [
    networkBoardComplete,
    networkDisplayBoard,
    orderedResourceCds,
    overlayActive,
    reconcileFetchParams,
    reconcileParamsKey,
    seibanOrFilters
  ]);

  return {
    displayBoardForUi,
    listIncompleteForUi
  };
}
