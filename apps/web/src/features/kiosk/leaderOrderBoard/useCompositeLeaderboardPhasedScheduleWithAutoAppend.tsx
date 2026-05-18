import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';

import {
  postKioskProductionScheduleLeaderboardBoardContinue,
  type KioskProductionScheduleLeaderboardBoardQueryParams,
  type KioskProductionScheduleLeaderboardPhasedQueryParams,
  type ProductionScheduleLeaderboardBoardResponse,
  type ProductionScheduleListResponse
} from '../../../api/client';
import { useKioskProductionScheduleLeaderboardBoard } from '../../../api/hooks';

import { buildLeaderboardBoardContinuePayload } from './buildLeaderboardBoardContinuePayload';
import {
  classifyLeaderboardContinueFailure,
  normalizeLeaderboardContinueFailure
} from './leaderboardContinueErrorPolicy';

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
  const leaderboardPhasedBaseParamsKey = useMemo(
    () => JSON.stringify(leaderboardPhasedBaseParams),
    [leaderboardPhasedBaseParams]
  );
  const resourceCdsOrderedKey = useMemo(() => resourceCdsOrdered.join('\0'), [resourceCdsOrdered]);

  const boardQueryParams = useMemo((): KioskProductionScheduleLeaderboardBoardQueryParams | undefined => {
    if (!scheduleEnabled || resourceCdsOrderedKey.length === 0) return undefined;
    const baseParams = JSON.parse(leaderboardPhasedBaseParamsKey) as KioskProductionScheduleLeaderboardPhasedQueryParams;
    const orderedResourceCds = resourceCdsOrderedKey.split('\0');
    return {
      ...baseParams,
      boardResourceCds: orderedResourceCds.join(',')
    };
  }, [leaderboardPhasedBaseParamsKey, resourceCdsOrderedKey, scheduleEnabled]);

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

  useEffect(() => {
    if (!scheduleEnabled || !boardQuery.isSuccess || !boardQuery.data || !boardQueryParams) return;
    if (!boardQuery.data.resources.some((r) => r.hasMore)) return;

    const shellAt = boardQuery.dataUpdatedAt;
    if (appendSessionForShellAtRef.current === shellAt) return;
    appendSessionForShellAtRef.current = shellAt;

    const runId = ++appendRunIdRef.current;
    let cancelled = false;

    void (async () => {
      try {
        let cur: ProductionScheduleLeaderboardBoardResponse = boardQuery.data!;
        while (!cancelled && runId === appendRunIdRef.current && cur.resources.some((r) => r.hasMore)) {
          setIsAppending(true);
          setAppendError(null);
          const payload = buildLeaderboardBoardContinuePayload(boardQueryParams, cur);
          const next = await postKioskProductionScheduleLeaderboardBoardContinue(
            payload
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
          const normalized = normalizeLeaderboardContinueFailure(e);
          if (classifyLeaderboardContinueFailure(normalized) === 'terminal') {
            setAppendError(normalized);
          }
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
    boardQueryParams,
    queryClient,
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
