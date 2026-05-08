import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';

import {
  postKioskProductionScheduleLeaderboardBoardContinue,
  type KioskProductionScheduleLeaderboardBoardContinuePayload,
  type KioskProductionScheduleLeaderboardBoardQueryParams,
  type KioskProductionScheduleLeaderboardPhasedQueryParams,
  type ProductionScheduleLeaderboardBoardResponse,
  type ProductionScheduleListResponse
} from '../../../api/client';
import { useKioskProductionScheduleLeaderboardBoard } from '../../../api/hooks';

import { LEADER_ORDER_BOARD_SHELL_PAGE_SIZE } from './constants';

function getCompositeLeaderboardDebugRunId() {
  if (typeof window === 'undefined') return `leaderboard-composite-server-${Date.now()}`;
  const key = 'cursor-debug-leaderboard-composite-run-id';
  const existing = window.sessionStorage.getItem(key);
  if (existing) return existing;
  const created = `leaderboard-composite-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  window.sessionStorage.setItem(key, created);
  return created;
}

function postCompositeLeaderboardDebugLog(
  hypothesisId: string,
  location: string,
  message: string,
  data: Record<string, unknown>
) {
  if (typeof window === 'undefined') return;
  // #region agent log
  fetch('http://127.0.0.1:7426/ingest/2502f74a-7c46-49e5-b1c6-8c32b7781f8e', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Debug-Session-Id': 'dd2d0f' },
    body: JSON.stringify({
      sessionId: 'dd2d0f',
      runId: getCompositeLeaderboardDebugRunId(),
      hypothesisId,
      location,
      message,
      data,
      timestamp: Date.now()
    })
  }).catch(() => {});
  // #endregion
}

function buildBoardContinuePayload(
  base: KioskProductionScheduleLeaderboardBoardQueryParams,
  resourceCdsOrdered: string[],
  board: ProductionScheduleLeaderboardBoardResponse
): KioskProductionScheduleLeaderboardBoardContinuePayload {
  const { page: _p, pageSize: _ps, ...rest } = base;
  void _p;
  void _ps;
  return {
    ...rest,
    boardResourceCds: resourceCdsOrdered.join(','),
    resourceSlices: board.resources.map((r) => ({
      resourceCd: r.resourceCd,
      snapshotId: r.snapshotId,
      cursor: r.nextCursor,
      hasMore: r.hasMore
    })),
    pageSize: board.pageSize ?? LEADER_ORDER_BOARD_SHELL_PAGE_SIZE
  };
}

/**
 * 多資源カードの順位ボード取得（集約 API 1 本＋サーバ側 shell 相当をスロット順に連結）。
 * 取得済み行の装飾は API 応答に同梱される（取得完了を待たずに段階的に表示）。
 */
export function useCompositeLeaderboardPhasedScheduleWithAutoAppend(options: {
  /** `resourceCds` / `boardResourceCds` を含めない（集約 params で上書きする） */
  leaderboardPhasedBaseParams: KioskProductionScheduleLeaderboardPhasedQueryParams;
  /** スロット順など、画面上のカード並び */
  resourceCdsOrdered: string[];
  scheduleEnabled: boolean;
  pauseRefetch: boolean;
  refetchIntervalMs: number;
  macManualOrderV2: boolean;
  activeDeviceScopeKey: string;
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
} {
  const {
    leaderboardPhasedBaseParams,
    resourceCdsOrdered,
    scheduleEnabled,
    pauseRefetch,
    refetchIntervalMs,
    macManualOrderV2,
    activeDeviceScopeKey
  } = options;

  const queryClient = useQueryClient();

  const boardQueryParams = useMemo((): KioskProductionScheduleLeaderboardBoardQueryParams | undefined => {
    if (!scheduleEnabled || resourceCdsOrdered.length === 0) return undefined;
    return {
      ...leaderboardPhasedBaseParams,
      boardResourceCds: resourceCdsOrdered.join(',')
    };
  }, [leaderboardPhasedBaseParams, resourceCdsOrdered, scheduleEnabled]);

  const paramsKey = useMemo(() => JSON.stringify(boardQueryParams), [boardQueryParams]);

  const [appendOverride, setAppendOverride] = useState<ProductionScheduleLeaderboardBoardResponse | null>(null);
  const [appendError, setAppendError] = useState<Error | null>(null);
  const [isAppending, setIsAppending] = useState(false);
  const appendRunIdRef = useRef(0);
  /** 同一 shell 応答（dataUpdatedAt）に対する追補セッションを一度だけ開始する */
  const appendSessionForShellAtRef = useRef<number | null>(null);

  useEffect(() => {
    appendSessionForShellAtRef.current = null;
    setAppendOverride(null);
    setAppendError(null);
  }, [paramsKey]);

  const boardQuery = useKioskProductionScheduleLeaderboardBoard(boardQueryParams, {
    enabled: scheduleEnabled && resourceCdsOrdered.length > 0,
    pauseRefetch,
    refetchIntervalMs
  });

  const displayBoard = appendOverride ?? boardQuery.data;

  const listIncomplete = useMemo(() => {
    if (!displayBoard) return false;
    return displayBoard.resources.some((r) => r.hasMore || (typeof r.nextCursor === 'number' && r.nextCursor < r.total));
  }, [displayBoard]);

  const compositeStatusSignatureRef = useRef<string | null>(null);
  useEffect(() => {
    if (!scheduleEnabled) return;
    const signature = JSON.stringify({
      resources: resourceCdsOrdered,
      mergedRowCount: displayBoard?.rows.length ?? 0,
      totalSum: displayBoard?.total ?? 0,
      listIncomplete,
      boardSource: appendOverride != null ? 'append-override' : 'query'
    });
    if (compositeStatusSignatureRef.current === signature) return;
    compositeStatusSignatureRef.current = signature;
    // #region agent log
    postCompositeLeaderboardDebugLog(
      'H4',
      'useCompositeLeaderboardPhasedScheduleWithAutoAppend.tsx:composite-status',
      'leaderboard composite board status',
      {
        resources: resourceCdsOrdered,
        mergedRowCount: displayBoard?.rows.length ?? 0,
        totalSum: displayBoard?.total ?? 0,
        listIncomplete,
        appendOverride: appendOverride != null
      }
    );
    // #endregion
  }, [appendOverride, displayBoard?.rows.length, displayBoard?.total, listIncomplete, resourceCdsOrdered, scheduleEnabled]);

  useEffect(() => {
    if (!scheduleEnabled || !boardQuery.isSuccess || !boardQuery.data) return;
    if (!boardQuery.data.resources.some((r) => r.hasMore)) return;

    const shellAt = boardQuery.dataUpdatedAt;
    if (appendSessionForShellAtRef.current === shellAt) return;
    appendSessionForShellAtRef.current = shellAt;

    const runId = ++appendRunIdRef.current;
    let cancelled = false;

    const fullBoardParams: KioskProductionScheduleLeaderboardBoardQueryParams = {
      ...leaderboardPhasedBaseParams,
      boardResourceCds: resourceCdsOrdered.join(',')
    };

    void (async () => {
      try {
        let cur: ProductionScheduleLeaderboardBoardResponse = boardQuery.data!;
        while (!cancelled && runId === appendRunIdRef.current && cur.resources.some((r) => r.hasMore)) {
          setIsAppending(true);
          setAppendError(null);
          const next = await postKioskProductionScheduleLeaderboardBoardContinue(
            buildBoardContinuePayload(fullBoardParams, resourceCdsOrdered, cur)
          );
          if (next.snapshotExpired) {
            await queryClient.invalidateQueries({ queryKey: ['kiosk-production-schedule'] });
            break;
          }
          setAppendOverride(next);
          cur = next;
        }
      } catch (e) {
        if (!cancelled && runId === appendRunIdRef.current) {
          setAppendError(e instanceof Error ? e : new Error(String(e)));
        }
      } finally {
        if (runId === appendRunIdRef.current) setIsAppending(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [
    boardQuery.data,
    boardQuery.dataUpdatedAt,
    boardQuery.isSuccess,
    leaderboardPhasedBaseParams,
    queryClient,
    resourceCdsOrdered,
    scheduleEnabled
  ]);

  const scheduleQuery = useMemo(() => {
    if (!scheduleEnabled || resourceCdsOrdered.length === 0) {
      return {
        data: undefined as ProductionScheduleListResponse | undefined,
        isLoading: false,
        isError: false,
        isFetching: false
      };
    }

    if (!displayBoard) {
      return {
        data: undefined as ProductionScheduleListResponse | undefined,
        isLoading: boardQuery.isLoading,
        isError: boardQuery.isError,
        isFetching: boardQuery.isFetching || isAppending
      };
    }

    const data: ProductionScheduleListResponse = {
      page: displayBoard.page,
      pageSize: displayBoard.pageSize,
      total: displayBoard.total,
      rows: displayBoard.rows,
      ...(displayBoard.leaderboardFooterChipsByPartKey
        ? { leaderboardFooterChipsByPartKey: displayBoard.leaderboardFooterChipsByPartKey }
        : {})
    };

    return {
      data,
      isLoading: boardQuery.isLoading && displayBoard.rows.length === 0,
      isError: boardQuery.isError,
      isFetching: boardQuery.isFetching || isAppending
    };
  }, [
    boardQuery.isError,
    boardQuery.isFetching,
    boardQuery.isLoading,
    displayBoard,
    isAppending,
    resourceCdsOrdered.length,
    scheduleEnabled
  ]);

  void macManualOrderV2;
  void activeDeviceScopeKey;

  return {
    scheduleQuery,
    appendError,
    feedMounts: null,
    listIncomplete
  };
}
