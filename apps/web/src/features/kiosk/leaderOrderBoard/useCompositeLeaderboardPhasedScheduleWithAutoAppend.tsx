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
  resolveLeaderboardAppendLoopStartBoard,
  shouldBeginLeaderboardAppendSession
} from './leaderboardBoardAppendSessionPolicy';
import {
  fingerprintLeaderboardBoardShell,
  isLeaderboardScheduleInitialLoading,
  pickLeaderboardBoardForDisplay
} from './leaderboardBoardDisplayPolicy';
import {
  classifyLeaderboardContinueFailure,
  normalizeLeaderboardContinueFailure
} from './leaderboardContinueErrorPolicy';
import { mergeLeaderboardBoardContinueResponseWithOptionalDelta } from './mergeLeaderboardBoardContinueResponse';

/** 端末無効時に同一参照を返し、下流の再レンダーを安定させる */
const SCHEDULE_QUERY_DISABLED = {
  data: undefined as ProductionScheduleListResponse | undefined,
  isLoading: false,
  isError: false,
  isFetching: false
};

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
  const orderedResourceCds = useMemo(
    () => (resourceCdsOrderedKey.length > 0 ? resourceCdsOrderedKey.split('\0') : []),
    [resourceCdsOrderedKey]
  );

  const boardQueryParams = useMemo((): KioskProductionScheduleLeaderboardBoardQueryParams | undefined => {
    if (!scheduleEnabled || resourceCdsOrderedKey.length === 0) return undefined;
    const baseParams = JSON.parse(leaderboardPhasedBaseParamsKey) as KioskProductionScheduleLeaderboardPhasedQueryParams;
    return {
      ...baseParams,
      boardResourceCds: orderedResourceCds.join(',')
    };
  }, [leaderboardPhasedBaseParamsKey, orderedResourceCds, resourceCdsOrderedKey, scheduleEnabled]);

  const paramsKey = useMemo(() => JSON.stringify(boardQueryParams), [boardQueryParams]);

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
    setAppendError(null);
  }, [paramsKey]);

  const boardQuery = useKioskProductionScheduleLeaderboardBoard(boardQueryParams, {
    enabled: scheduleEnabled && resourceCdsOrdered.length > 0,
    pauseRefetch,
    refetchIntervalMs
  });

  const shellFingerprint = useMemo(
    () => fingerprintLeaderboardBoardShell(boardQuery.data),
    [boardQuery.data]
  );

  const displayBoard = pickLeaderboardBoardForDisplay(boardQuery.data, appendOverride);

  const listIncomplete = useMemo(() => {
    if (!displayBoard) return false;
    return displayBoard.resources.some((r) => r.hasMore || (typeof r.nextCursor === 'number' && r.nextCursor < r.total));
  }, [displayBoard]);

  useEffect(() => {
    if (!scheduleEnabled || !boardQuery.isSuccess || !boardQuery.data || !boardQueryParams) return;

    const shell = boardQuery.data;
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
        let cur = resolveLeaderboardAppendLoopStartBoard(shell, appendOverrideRef.current);
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
            await queryClient.invalidateQueries({ queryKey: ['kiosk-production-schedule'] });
            break;
          }
          const next =
            orderedResourceCds.length > 0
              ? mergeLeaderboardBoardContinueResponseWithOptionalDelta(cur.rows, nextRaw, orderedResourceCds)
              : nextRaw;
          setAppendOverride(next);
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
    scheduleEnabled,
    shellFingerprint,
    orderedResourceCds
  ]);

  const scheduleQuery = useMemo(() => {
    if (!scheduleEnabled || resourceCdsOrdered.length === 0) {
      return SCHEDULE_QUERY_DISABLED;
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
      isLoading: isLeaderboardScheduleInitialLoading(boardQuery.isLoading, displayBoard.rows.length),
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
