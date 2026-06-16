import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import {
  postKioskProductionScheduleLeaderboardDecorations,
  type LeaderboardBoardResourceSliceResponse,
  type ProductionScheduleRow,
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

const LEADER_BOARD_DECORATION_PRIORITY_ROWS_PER_RESOURCE = 8;
const LEADER_BOARD_DECORATION_BACKGROUND_BATCH_SIZE = 80;
const LEADER_BOARD_DECORATION_BACKGROUND_DELAY_MS = 80;

function getLeaderboardRowResourceCd(row: Pick<ProductionScheduleRow, 'rowData'>): string {
  const data = (row.rowData ?? {}) as Record<string, unknown>;
  const resourceCd = data.FSIGENCD;
  return typeof resourceCd === 'string' ? resourceCd.trim() : '';
}

function getLeaderboardRowId(row: Pick<ProductionScheduleRow, 'id'>): string {
  return row.id.trim();
}

function uniqueNonEmpty(values: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    const v = value.trim();
    if (v.length === 0 || seen.has(v)) continue;
    seen.add(v);
    out.push(v);
  }
  return out;
}

function chunkRowIds(rowIds: readonly string[], size: number): string[][] {
  if (size <= 0) return rowIds.length > 0 ? [[...rowIds]] : [];
  const chunks: string[][] = [];
  for (let i = 0; i < rowIds.length; i += size) {
    chunks.push(rowIds.slice(i, i + size));
  }
  return chunks;
}

export function buildLeaderboardDecorationFetchBatches(options: {
  rows: readonly ProductionScheduleRow[];
  resources: readonly LeaderboardBoardResourceSliceResponse[];
  pendingRowIds: readonly string[];
}): {
  priorityRowIds: string[];
  backgroundRowIdBatches: string[][];
} {
  const pendingRowIds = uniqueNonEmpty(options.pendingRowIds);
  if (pendingRowIds.length === 0) {
    return { priorityRowIds: [], backgroundRowIdBatches: [] };
  }

  const pendingSet = new Set(pendingRowIds);
  const rowsByResourceCd = new Map<string, ProductionScheduleRow[]>();
  for (const row of options.rows) {
    const resourceCd = getLeaderboardRowResourceCd(row);
    if (resourceCd.length === 0) continue;
    const list = rowsByResourceCd.get(resourceCd);
    if (list) {
      list.push(row);
    } else {
      rowsByResourceCd.set(resourceCd, [row]);
    }
  }

  const resourceOrder = uniqueNonEmpty(options.resources.map((r) => r.resourceCd));
  const priorityRowIds: string[] = [];
  const prioritySet = new Set<string>();

  for (const resourceCd of resourceOrder) {
    const rows = rowsByResourceCd.get(resourceCd) ?? [];
    let pickedForResource = 0;
    for (const row of rows) {
      if (pickedForResource >= LEADER_BOARD_DECORATION_PRIORITY_ROWS_PER_RESOURCE) break;
      const rowId = getLeaderboardRowId(row);
      if (rowId.length === 0 || !pendingSet.has(rowId) || prioritySet.has(rowId)) continue;
      prioritySet.add(rowId);
      priorityRowIds.push(rowId);
      pickedForResource += 1;
    }
  }

  const effectivePriorityRowIds =
    priorityRowIds.length > 0
      ? priorityRowIds
      : pendingRowIds.slice(0, LEADER_BOARD_DECORATION_BACKGROUND_BATCH_SIZE);
  const effectivePrioritySet = new Set(effectivePriorityRowIds);
  const backgroundRowIds = pendingRowIds.filter((rowId) => !effectivePrioritySet.has(rowId));

  return {
    priorityRowIds: effectivePriorityRowIds,
    backgroundRowIdBatches: chunkRowIds(
      backgroundRowIds,
      LEADER_BOARD_DECORATION_BACKGROUND_BATCH_SIZE
    )
  };
}

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

    const { priorityRowIds, backgroundRowIdBatches } = buildLeaderboardDecorationFetchBatches({
      rows,
      resources: displayBoard.resources,
      pendingRowIds: pending
    });
    if (priorityRowIds.length === 0) {
      return;
    }

    const runId = ++fetchRunIdRef.current;
    let cancelled = false;
    const pendingBackgroundWaits = new Set<() => void>();
    const rowsById = new Map(rows.map((r) => [getLeaderboardRowId(r), r] as const));
    const syncTokenAtFetch = boardNetworkSyncToken;

    const rememberFetchedRows = (rowIds: readonly string[]) => {
      const refreshedPartKeys = new Set<string>();
      for (const rowId of rowIds) {
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
    };

    const fetchDecorationBatch = async (rowIds: readonly string[]) => {
      const response = await postKioskProductionScheduleLeaderboardDecorations({
        rowIds: [...rowIds],
        ...(macManualOrderV2 && activeDeviceScopeKey.trim().length > 0
          ? { targetDeviceScopeKey: activeDeviceScopeKey.trim() }
          : {})
      });
      if (cancelled || runId !== fetchRunIdRef.current) return false;
      rememberFetchedRows(rowIds);
      setAccumulated((prev) => mergeLeaderboardDecorationsIntoAccumulator(prev, response));
      return true;
    };

    const waitForBackgroundBatch = () =>
      new Promise<void>((resolve) => {
        const finish = () => {
          clearTimeout(timer);
          pendingBackgroundWaits.delete(finish);
          resolve();
        };
        const timer = setTimeout(finish, LEADER_BOARD_DECORATION_BACKGROUND_DELAY_MS);
        pendingBackgroundWaits.add(finish);
      });

    void (async () => {
      setIsDecorationsFetching(true);
      setDecorationsError(null);
      try {
        const fetchedPriority = await fetchDecorationBatch(priorityRowIds);
        if (!fetchedPriority) return;
      } catch (e) {
        if (!cancelled && runId === fetchRunIdRef.current) {
          setDecorationsError(e instanceof Error ? e : new Error(String(e)));
        }
      } finally {
        if (!cancelled && runId === fetchRunIdRef.current) {
          setIsDecorationsFetching(false);
        }
      }

      for (const rowIds of backgroundRowIdBatches) {
        if (cancelled || runId !== fetchRunIdRef.current) return;
        await waitForBackgroundBatch();
        if (cancelled || runId !== fetchRunIdRef.current) return;
        try {
          const fetchedBackground = await fetchDecorationBatch(rowIds);
          if (!fetchedBackground) return;
        } catch (e) {
          if (!cancelled && runId === fetchRunIdRef.current) {
            setDecorationsError(e instanceof Error ? e : new Error(String(e)));
          }
          return;
        }
      }
    })();

    return () => {
      cancelled = true;
      pendingBackgroundWaits.forEach((finish) => finish());
      pendingBackgroundWaits.clear();
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
