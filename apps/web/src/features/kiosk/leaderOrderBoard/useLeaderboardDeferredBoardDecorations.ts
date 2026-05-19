import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import {
  postKioskProductionScheduleLeaderboardDecorations,
  type ProductionScheduleLeaderboardBoardResponse,
  type ProductionScheduleRow
} from '../../../api/client';

import {
  createEmptyAccumulatedLeaderboardDecorations,
  listUndecoratedLeaderboardRowIds,
  mergeLeaderboardDecorationsIntoAccumulator,
  type AccumulatedLeaderboardDecorations
} from './mergeLeaderboardBoardWithDecorations';

/**
 * board 集約の light 行に対し `leaderboard-decorations` を増分取得して累積する。
 */
export function useLeaderboardDeferredBoardDecorations(options: {
  scheduleEnabled: boolean;
  paramsKey: string;
  displayBoard: ProductionScheduleLeaderboardBoardResponse | undefined;
  macManualOrderV2: boolean;
  activeDeviceScopeKey: string;
  pauseRefetch: boolean;
}): {
  accumulatedDecorations: AccumulatedLeaderboardDecorations;
  isDecorationsFetching: boolean;
  decorationsError: Error | null;
  resetDecorations: () => void;
} {
  const { scheduleEnabled, paramsKey, displayBoard, macManualOrderV2, activeDeviceScopeKey, pauseRefetch } =
    options;

  const [accumulated, setAccumulated] = useState(createEmptyAccumulatedLeaderboardDecorations);
  const [isDecorationsFetching, setIsDecorationsFetching] = useState(false);
  const [decorationsError, setDecorationsError] = useState<Error | null>(null);
  const decoratedIdsRef = useRef<Set<string>>(new Set());
  const paramsKeyRef = useRef<string | null>(null);
  const fetchRunIdRef = useRef(0);

  const resetDecorations = useCallback(() => {
    fetchRunIdRef.current += 1;
    decoratedIdsRef.current = new Set();
    setAccumulated(createEmptyAccumulatedLeaderboardDecorations());
    setDecorationsError(null);
    setIsDecorationsFetching(false);
  }, []);

  const rowIdsKey = useMemo(() => {
    const rows = displayBoard?.rows ?? [];
    return rows.map((r) => r.id).join('\u0001');
  }, [displayBoard?.rows]);

  useEffect(() => {
    if (paramsKeyRef.current === paramsKey) return;
    paramsKeyRef.current = paramsKey;
    fetchRunIdRef.current += 1;
    decoratedIdsRef.current = new Set();
    setAccumulated(createEmptyAccumulatedLeaderboardDecorations());
    setDecorationsError(null);
    setIsDecorationsFetching(false);
  }, [paramsKey]);

  useEffect(() => {
    if (!scheduleEnabled || pauseRefetch || !displayBoard || displayBoard.rows.length === 0) {
      return;
    }

    const rowIds = displayBoard.rows.map((r: ProductionScheduleRow) => r.id);
    const pending = listUndecoratedLeaderboardRowIds(rowIds, decoratedIdsRef.current);
    if (pending.length === 0) {
      return;
    }

    const runId = ++fetchRunIdRef.current;
    let cancelled = false;

    void (async () => {
      setIsDecorationsFetching(true);
      setDecorationsError(null);
      try {
        const response = await postKioskProductionScheduleLeaderboardDecorations({
          rowIds: pending,
          ...(macManualOrderV2 && activeDeviceScopeKey.trim().length > 0
            ? { targetDeviceScopeKey: activeDeviceScopeKey.trim() }
            : {})
        });
        if (cancelled || runId !== fetchRunIdRef.current) return;
        for (const id of pending) {
          decoratedIdsRef.current.add(id);
        }
        setAccumulated((prev) => mergeLeaderboardDecorationsIntoAccumulator(prev, response));
      } catch (e) {
        if (!cancelled && runId === fetchRunIdRef.current) {
          setDecorationsError(e instanceof Error ? e : new Error(String(e)));
        }
      } finally {
        if (!cancelled && runId === fetchRunIdRef.current) {
          setIsDecorationsFetching(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [
    activeDeviceScopeKey,
    displayBoard,
    macManualOrderV2,
    pauseRefetch,
    rowIdsKey,
    scheduleEnabled
  ]);

  return {
    accumulatedDecorations: accumulated,
    isDecorationsFetching,
    decorationsError,
    resetDecorations
  };
}
