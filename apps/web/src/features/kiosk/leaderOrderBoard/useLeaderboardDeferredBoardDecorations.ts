import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import {
  postKioskProductionScheduleLeaderboardDecorations,
  type ProductionScheduleLeaderboardBoardResponse
} from '../../../api/client';

import {
  buildLeaderboardPartKeyFromScheduleRow,
  buildLeaderboardRowDecorationProgressToken,
  listLeaderboardRowIdsNeedingDecorationFetch,
  removeLeaderboardFetchedDecorationProgressTokens,
  removeLeaderboardFetchedFooterSyncTokensForRows
} from './leaderboardDecorationStalePolicy';
import {
  createEmptyAccumulatedLeaderboardDecorations,
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
  /** ネットワーク shell の再同期指紋（同一表示行でも部品 footer を再検証する） */
  boardNetworkSyncToken: string;
  macManualOrderV2: boolean;
  activeDeviceScopeKey: string;
  pauseRefetch: boolean;
}): {
  accumulatedDecorations: AccumulatedLeaderboardDecorations;
  isDecorationsFetching: boolean;
  decorationsError: Error | null;
  resetDecorations: () => void;
  /** 完了などで行状態が変わった行の装飾を再取得対象へ戻す */
  markDecorationRowsStale: (rowIds: readonly string[]) => void;
} {
  const {
    scheduleEnabled,
    paramsKey,
    displayBoard,
    boardNetworkSyncToken,
    macManualOrderV2,
    activeDeviceScopeKey,
    pauseRefetch
  } = options;

  const [accumulated, setAccumulated] = useState(createEmptyAccumulatedLeaderboardDecorations);
  const [isDecorationsFetching, setIsDecorationsFetching] = useState(false);
  const [decorationsError, setDecorationsError] = useState<Error | null>(null);
  const [decorationFetchEpoch, setDecorationFetchEpoch] = useState(0);
  /** rowId → 直近の装飾取得成功時の `rowData.progress` トークン */
  const fetchedProgressByRowIdRef = useRef<Map<string, string>>(new Map());
  /** partKey → 直近 footer 取得成功時の boardNetworkSyncToken */
  const footerFetchedBoardSyncTokenByPartKeyRef = useRef<Map<string, string>>(new Map());
  const displayBoardRef = useRef(displayBoard);
  const paramsKeyRef = useRef<string | null>(null);
  const fetchRunIdRef = useRef(0);

  displayBoardRef.current = displayBoard;

  const resetDecorations = useCallback(() => {
    fetchRunIdRef.current += 1;
    fetchedProgressByRowIdRef.current = new Map();
    footerFetchedBoardSyncTokenByPartKeyRef.current = new Map();
    setAccumulated(createEmptyAccumulatedLeaderboardDecorations());
    setDecorationsError(null);
    setIsDecorationsFetching(false);
  }, []);

  const markDecorationRowsStale = useCallback((rowIds: readonly string[]) => {
    const hasTarget = rowIds.some((id) => id.trim().length > 0);
    if (!hasTarget) return;
    const rows = displayBoardRef.current?.rows ?? [];
    removeLeaderboardFetchedDecorationProgressTokens(fetchedProgressByRowIdRef.current, rowIds);
    removeLeaderboardFetchedFooterSyncTokensForRows(
      footerFetchedBoardSyncTokenByPartKeyRef.current,
      rows,
      rowIds
    );
    setDecorationFetchEpoch((n) => n + 1);
  }, []);

  const rowProgressKey = useMemo(() => {
    const rows = displayBoard?.rows ?? [];
    return rows
      .map((r) => `${r.id}:${buildLeaderboardRowDecorationProgressToken(r)}`)
      .join('\u0001');
  }, [displayBoard?.rows]);

  useEffect(() => {
    if (paramsKeyRef.current === paramsKey) return;
    paramsKeyRef.current = paramsKey;
    fetchRunIdRef.current += 1;
    fetchedProgressByRowIdRef.current = new Map();
    footerFetchedBoardSyncTokenByPartKeyRef.current = new Map();
    setAccumulated(createEmptyAccumulatedLeaderboardDecorations());
    setDecorationsError(null);
    setIsDecorationsFetching(false);
  }, [paramsKey]);

  useEffect(() => {
    if (!scheduleEnabled || pauseRefetch || !displayBoard || displayBoard.rows.length === 0) {
      return;
    }

    const rows = displayBoard.rows;
    const pending = listLeaderboardRowIdsNeedingDecorationFetch(
      rows,
      fetchedProgressByRowIdRef.current,
      {
        boardNetworkSyncToken,
        footerFetchedBoardSyncTokenByPartKey: footerFetchedBoardSyncTokenByPartKeyRef.current
      }
    );
    if (pending.length === 0) {
      return;
    }

    const runId = ++fetchRunIdRef.current;
    let cancelled = false;
    const rowsById = new Map(rows.map((r) => [r.id, r] as const));
    const syncTokenAtFetch = boardNetworkSyncToken;

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
        const refreshedPartKeys = new Set<string>();
        for (const rowId of pending) {
          const row = rowsById.get(rowId);
          if (!row) continue;
          fetchedProgressByRowIdRef.current.set(
            rowId,
            buildLeaderboardRowDecorationProgressToken(row)
          );
          refreshedPartKeys.add(buildLeaderboardPartKeyFromScheduleRow(row));
        }
        if (syncTokenAtFetch.length > 0) {
          for (const partKey of refreshedPartKeys) {
            footerFetchedBoardSyncTokenByPartKeyRef.current.set(partKey, syncTokenAtFetch);
          }
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
    boardNetworkSyncToken,
    decorationFetchEpoch,
    displayBoard,
    macManualOrderV2,
    pauseRefetch,
    rowProgressKey,
    scheduleEnabled
  ]);

  return {
    accumulatedDecorations: accumulated,
    isDecorationsFetching,
    decorationsError,
    resetDecorations,
    markDecorationRowsStale
  };
}
