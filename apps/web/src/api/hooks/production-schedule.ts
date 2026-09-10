import { useMutation, useQuery, useQueryClient, type QueryKey } from '@tanstack/react-query';
import { useEffect, useMemo, useRef, useState } from 'react';

import { normalizeLeaderboardContinueFailure } from '../../features/kiosk/leaderOrderBoard/leaderboardContinueErrorPolicy';
import {
  LEADER_BOARD_LEADER_PHASED_STALE_MS,
  LEADER_BOARD_SCHEDULE_REFETCH_MS
} from '../../features/kiosk/leaderOrderBoard/performance/leaderBoardRefetchPolicy';
import {
  findProcessingOrderForRow,
  patchOrderUsageForProcessingOrderChange,
  patchScheduleListProcessingOrder
} from '../../features/kiosk/productionSchedule/cache/kioskProductionScheduleOrderCachePatch';
import {
  setKioskProductionScheduleRowCompletion,
  getKioskProductionSchedule,
  getKioskProductionScheduleLeaderboardShell,
  getKioskProductionScheduleLeaderboardTotal,
  getKioskProductionScheduleLeaderboardBoard,
  postKioskProductionScheduleLeaderboardDecorations,
  type KioskProductionScheduleLeaderboardPhasedQueryParams,
  type KioskProductionScheduleLeaderboardBoardQueryParams,
  getKioskProductionScheduleOrderSearchCandidates,
  getKioskProductionScheduleOrderUsage,
  getKioskProductionScheduleResources,
  getKioskProductionScheduleDueManagementSummary,
  getKioskProductionScheduleDueManagementTriage,
  getKioskProductionScheduleDueManagementDailyPlan,
  getKioskProductionScheduleDueManagementGlobalRank,
  getKioskProductionScheduleDueManagementManualOrderOverview,
  getKioskProductionScheduleManualOrderSiteDevices,
  getKioskProductionScheduleManualOrderResourceAssignments,
  putKioskProductionScheduleManualOrderResourceAssignments,
  getKioskProductionScheduleDueManagementGlobalRankProposal,
  autoGenerateKioskProductionScheduleDueManagementGlobalRank,
  getKioskProductionScheduleDueManagementSeibanDetail,
  getKioskGrindingPlanningBoardDueDetail,
  getKioskProductionScheduleProgressOverview,
  getKioskProductionScheduleProcessingTypeOptions,
  getKioskProductionScheduleOrderSplitStatus,
  getKioskProductionScheduleSearchState,
  getKioskProductionScheduleSearchHistory,
  getKioskProductionScheduleHistoryProgress,
  getKioskGrindingPlanningBoard,
  getKioskGrindingPlanningBoardSnapshot,
  updateKioskGrindingPlanningBoardOverrides,
  updateKioskGrindingPlanningBoardRank,
  updateKioskGrindingPlanningBoardSeibanOrder,
  type KioskGrindingPlanningBoardQuery,
  postKioskProductionScheduleSeibanMachineNames,
  getProductionScheduleResourceCategorySettings,
  getProductionScheduleResourceCodeMappings,
  importProductionScheduleResourceCodeMappingsFromCsv,
  getProductionScheduleDueManagementAccessPasswordSettings,
  getProductionScheduleOrderSplitPilotSettings,
  getProductionScheduleProcessingTypeOptions,
  setKioskProductionScheduleSearchState,
  setKioskProductionScheduleSearchHistory,
  updateProductionScheduleResourceCategorySettings,
  updateProductionScheduleResourceCodeMappings,
  updateProductionScheduleDueManagementAccessPassword,
  updateProductionScheduleOrderSplitPilotSettings,
  updateProductionScheduleProcessingTypeOptions,
  updateKioskProductionScheduleOrder,
  updateKioskProductionScheduleNote,
  updateKioskProductionScheduleDueDate,
  updateKioskProductionScheduleSplitDueDate,
  updateKioskProductionScheduleSplitOrder,
  updateKioskProductionScheduleProcessing,
  updateKioskProductionScheduleDueManagementSeibanDueDate,
  updateKioskProductionScheduleDueManagementSeibanProcessingDueDate,
  updateKioskGrindingPlanningBoardDueScope,
  updateKioskProductionScheduleDueManagementPartPriorities,
  updateKioskProductionScheduleDueManagementPartProcessingType,
  updateKioskProductionScheduleDueManagementPartNote,
  updateKioskProductionScheduleDueManagementTriageSelection,
  updateKioskProductionScheduleDueManagementDailyPlan,
  updateKioskProductionScheduleDueManagementGlobalRank,
  verifyKioskDueManagementAccessPassword,
  getProductionScheduleLoadBalancingCapacityBase,
  getProductionScheduleLoadBalancingMonthlyCapacity,
  getProductionScheduleLoadBalancingClasses,
  getProductionScheduleLoadBalancingTransferRules,
  getProductionScheduleLoadBalancingWorkCalendars,
  updateProductionScheduleLoadBalancingCapacityBase,
  updateProductionScheduleLoadBalancingMonthlyCapacity,
  updateProductionScheduleLoadBalancingClasses,
  updateProductionScheduleLoadBalancingTransferRules,
  updateProductionScheduleLoadBalancingWorkCalendars,
  getKioskProductionScheduleLoadBalancingOverview,
  getKioskProductionScheduleLoadBalancingMachineMonthlyLoad,
  getKioskProductionScheduleLoadBalancingStartDateLeveling,
  postKioskProductionScheduleLoadBalancingStartDateLevelingSimulate,
  postKioskProductionScheduleLoadBalancingOutsourcingCandidates,
  postKioskProductionScheduleLoadBalancingOutsourcingPlan,
  postKioskProductionScheduleLoadBalancingOutsourcingReplacements,
  postKioskProductionScheduleLoadBalancingOutsourcingSimulate,
  postKioskProductionScheduleLoadBalancingSuggestions
} from '../client';

import type { KioskProductionScheduleListCache } from '../../features/kiosk/productionSchedule/cache/kioskProductionScheduleListCache';
import type {
  GrindingPlanningBoardOverridesRequest,
  GrindingPlanningBoardRankRequest,
  GrindingPlanningBoardSeibanOrderRequest,
  GrindingPlanningBoardResponse,
  GrindingPlanningBoardDueScopeRequest
} from '@raspi-system/shared-types';


export function useKioskProductionSchedule(
  params?: {
    productNo?: string;
    q?: string;
    productNos?: string;
    resourceCds?: string;
    resourceAssignedOnlyCds?: string;
    resourceCategory?: 'grinding' | 'cutting';
    machineName?: string;
    hasNoteOnly?: boolean;
    hasDueDateOnly?: boolean;
    page?: number;
    pageSize?: number;
    allowResourceOnly?: boolean;
    targetDeviceScopeKey?: string;
    responseProfile?: 'full' | 'leaderboard';
    selfInspectionEligibleOnly?: boolean;
  },
  options?: { enabled?: boolean; pauseRefetch?: boolean; refetchIntervalMs?: number | false }
) {
  const interval =
    options?.pauseRefetch ? false : (options?.refetchIntervalMs !== undefined ? options.refetchIntervalMs : 30000);
  return useQuery({
    queryKey: ['kiosk-production-schedule', params],
    queryFn: () => getKioskProductionSchedule(params),
    // 仕掛中が頻繁に変わるため軽く自動更新
    // NOTE: 書き込み操作（完了/未完了戻し/納期/備考/順番/処理など）と同時に走ると体感遅延が出やすいので、
    //       操作中はポーリングを止め、操作完了後に invalidate で再取得させる。
    refetchInterval: interval,
    placeholderData: (previousData) => previousData,
    enabled: options?.enabled ?? true
  });
}

export function useKioskProductionScheduleLeaderboardShell(
  params: KioskProductionScheduleLeaderboardPhasedQueryParams | undefined,
  options?: { enabled?: boolean; pauseRefetch?: boolean; refetchIntervalMs?: number | false }
) {
  const interval =
    options?.pauseRefetch ? false : (options?.refetchIntervalMs !== undefined ? options.refetchIntervalMs : 30000);
  return useQuery({
    queryKey: ['kiosk-production-schedule', 'leaderboard-shell', params],
    queryFn: () => getKioskProductionScheduleLeaderboardShell(params),
    placeholderData: (previousData) => previousData,
    refetchInterval: interval,
    staleTime: LEADER_BOARD_LEADER_PHASED_STALE_MS,
    refetchOnWindowFocus: false,
    enabled: (options?.enabled ?? true) && Boolean(params)
  });
}

export function useKioskProductionScheduleLeaderboardTotal(
  params: KioskProductionScheduleLeaderboardPhasedQueryParams | undefined,
  options?: { enabled?: boolean; pauseRefetch?: boolean; refetchIntervalMs?: number | false }
) {
  const interval =
    options?.pauseRefetch ? false : (options?.refetchIntervalMs !== undefined ? options.refetchIntervalMs : 30000);
  return useQuery({
    queryKey: ['kiosk-production-schedule', 'leaderboard-total', params],
    queryFn: () => getKioskProductionScheduleLeaderboardTotal(params),
    placeholderData: (previousData) => previousData,
    refetchInterval: interval,
    staleTime: LEADER_BOARD_LEADER_PHASED_STALE_MS,
    refetchOnWindowFocus: false,
    enabled: (options?.enabled ?? true) && Boolean(params)
  });
}

export function useKioskProductionScheduleLeaderboardDecorations(
  payload:
    | {
        rowIds: string[];
        targetDeviceScopeKey?: string;
      }
    | undefined,
  options?: { enabled?: boolean; pauseRefetch?: boolean; refetchIntervalMs?: number | false }
) {
  const interval =
    options?.pauseRefetch ? false : (options?.refetchIntervalMs !== undefined ? options.refetchIntervalMs : 30000);

  const rowFingerprint = payload?.rowIds.length ? payload.rowIds.join('\u0001') : '';

  return useQuery({
    queryKey: ['kiosk-production-schedule', 'leaderboard-decorations', rowFingerprint, payload?.targetDeviceScopeKey ?? ''],
    queryFn: () =>
      postKioskProductionScheduleLeaderboardDecorations({
        rowIds: payload!.rowIds,
        targetDeviceScopeKey: payload?.targetDeviceScopeKey
      }),
    placeholderData: (previousData) => previousData,
    refetchInterval: interval,
    staleTime: LEADER_BOARD_LEADER_PHASED_STALE_MS,
    refetchOnWindowFocus: false,
    enabled: (options?.enabled ?? true) && Boolean(payload && payload.rowIds.length > 0)
  });
}

/** 順位ボード（多資源スロット）集約 GET。追補は {@link useCompositeLeaderboardPhasedScheduleWithAutoAppend} 内の continue 呼び出し。 */

export function useKioskProductionScheduleLeaderboardBoard(
  params: KioskProductionScheduleLeaderboardBoardQueryParams | undefined,
  options?: { enabled?: boolean; pauseRefetch?: boolean; refetchIntervalMs?: number | false }
) {
  const interval =
    options?.pauseRefetch ? false : (options?.refetchIntervalMs !== undefined ? options.refetchIntervalMs : 30000);
  return useQuery({
    queryKey: ['kiosk-production-schedule', 'leaderboard-board', params],
    queryFn: () => getKioskProductionScheduleLeaderboardBoard(params!),
    placeholderData: (previousData) => previousData,
    refetchInterval: interval,
    staleTime: LEADER_BOARD_LEADER_PHASED_STALE_MS,
    refetchOnWindowFocus: false,
    enabled: (options?.enabled ?? true) && Boolean(params)
  });
}

export function useKioskProductionScheduleOrderSearchCandidates(
  params: {
    resourceCds: string;
    resourceCategory?: 'grinding' | 'cutting';
    machineName?: string;
    productNoPrefix: string;
    partName?: string;
  } | undefined,
  options?: { enabled?: boolean }
) {
  return useQuery({
    queryKey: ['kiosk-production-schedule-order-search', params],
    queryFn: () => getKioskProductionScheduleOrderSearchCandidates(params!),
    enabled: (options?.enabled ?? true) && Boolean(params)
  });
}

export function useKioskProductionScheduleResources(options?: {
  pauseRefetch?: boolean;
  refetchIntervalMs?: number | false;
}) {
  const interval =
    options?.pauseRefetch ? false : (options?.refetchIntervalMs !== undefined ? options.refetchIntervalMs : 60000);
  return useQuery({
    queryKey: ['kiosk-production-schedule-resources'],
    queryFn: getKioskProductionScheduleResources,
    refetchInterval: interval
  });
}

export function useKioskProductionScheduleProcessingTypeOptions(options?: { pauseRefetch?: boolean }) {
  return useQuery({
    queryKey: ['kiosk-production-schedule-processing-type-options'],
    queryFn: getKioskProductionScheduleProcessingTypeOptions,
    refetchInterval: options?.pauseRefetch ? false : 60000
  });
}

export function useKioskProductionScheduleOrderUsage(
  resourceCds?: string,
  options?: {
    pauseRefetch?: boolean;
    targetDeviceScopeKey?: string;
    enabled?: boolean;
    refetchIntervalMs?: number | false;
  }
) {
  const interval =
    options?.pauseRefetch ? false : (options?.refetchIntervalMs !== undefined ? options.refetchIntervalMs : 20000);
  return useQuery({
    queryKey: ['kiosk-production-schedule-order-usage', resourceCds, options?.targetDeviceScopeKey],
    queryFn: () =>
      getKioskProductionScheduleOrderUsage({
        ...(resourceCds ? { resourceCds } : {}),
        ...(options?.targetDeviceScopeKey ? { targetDeviceScopeKey: options.targetDeviceScopeKey } : {})
      }),
    refetchInterval: interval,
    enabled: options?.enabled ?? true
  });
}

export function useKioskProductionScheduleSearchState(options?: {
  pauseRefetch?: boolean;
  refetchIntervalMs?: number | false;
}) {
  const interval =
    options?.pauseRefetch ? false : (options?.refetchIntervalMs !== undefined ? options.refetchIntervalMs : 5500);
  return useQuery({
    queryKey: ['kiosk-production-schedule-search-state'],
    queryFn: getKioskProductionScheduleSearchState,
    refetchInterval: interval
  });
}

export function useKioskProductionScheduleSearchHistory(options?: { pauseRefetch?: boolean }) {
  return useQuery({
    queryKey: ['kiosk-production-schedule-search-history'],
    queryFn: getKioskProductionScheduleSearchHistory,
    refetchInterval: options?.pauseRefetch ? false : 5500,
  });
}

export function useKioskProductionScheduleHistoryProgress(options?: {
  pauseRefetch?: boolean;
  refetchIntervalMs?: number | false;
  enabled?: boolean;
}) {
  const interval =
    options?.pauseRefetch ? false : (options?.refetchIntervalMs !== undefined ? options.refetchIntervalMs : 30000);
  return useQuery({
    queryKey: ['kiosk-production-schedule-history-progress'],
    queryFn: getKioskProductionScheduleHistoryProgress,
    refetchInterval: interval,
    enabled: options?.enabled ?? true
  });
}

export function useKioskGrindingPlanningBoard(
  params: KioskGrindingPlanningBoardQuery | undefined,
  options?: {
    enabled?: boolean;
    refetchIntervalMs?: number | false;
    refetchOnWindowFocus?: boolean;
    staleTime?: number;
  }
) {
  return useQuery({
    queryKey: ['kiosk-grinding-planning-board', params],
    queryFn: () => getKioskGrindingPlanningBoard(params!),
    enabled: (options?.enabled ?? true) && Boolean(params),
    refetchInterval: options?.refetchIntervalMs ?? 30000,
    staleTime: options?.staleTime,
    refetchOnWindowFocus: options?.refetchOnWindowFocus,
    placeholderData: (previousData) => previousData
  });
}

export type KioskGrindingPlanningBoardProgressiveResult = {
  data: GrindingPlanningBoardResponse | undefined;
  isLoading: boolean;
  isFetching: boolean;
  isError: boolean;
  error: unknown;
  isPlaceholderData: boolean;
  refetch: ReturnType<typeof useKioskGrindingPlanningBoard>['refetch'];
  scopeReady: boolean;
  isAppending: boolean;
  isComplete: boolean;
  appendError: unknown;
};

/**
 * 初回ページを先に表示し、同じスナップショットの残りだけを順次追補する。
 * 順位ボードのphased取得と同じ300秒のstale/refetch方針を使うが、契約が異なるため
 * continue部分はこのAPI専用の薄いアダプターとして保持する。
 */
export function useKioskGrindingPlanningBoardProgressive(
  params: KioskGrindingPlanningBoardQuery | undefined,
  options?: { enabled?: boolean; refetchIntervalMs?: number | false }
): KioskGrindingPlanningBoardProgressiveResult {
  const query = useKioskGrindingPlanningBoard(params, {
    enabled: options?.enabled,
    refetchIntervalMs: options?.refetchIntervalMs ?? LEADER_BOARD_SCHEDULE_REFETCH_MS,
    refetchOnWindowFocus: false,
    staleTime: LEADER_BOARD_LEADER_PHASED_STALE_MS
  });
  const paramsKey = useMemo(() => JSON.stringify(params ?? null), [params]);
  const [mergedData, setMergedData] = useState<GrindingPlanningBoardResponse>();
  const [isAppending, setIsAppending] = useState(false);
  const [isComplete, setIsComplete] = useState(false);
  const [appendError, setAppendError] = useState<unknown>(null);
  const runIdRef = useRef(0);
  const syncedSignatureRef = useRef<string | null>(null);
  const stableParams = useMemo(
    () => paramsKey === 'null' ? undefined : JSON.parse(paramsKey) as KioskGrindingPlanningBoardQuery,
    [paramsKey]
  );

  useEffect(() => {
    runIdRef.current += 1;
    syncedSignatureRef.current = null;
    setMergedData(undefined);
    setIsAppending(false);
    setIsComplete(false);
    setAppendError(null);
  }, [paramsKey]);

  const firstData = query.data;
  const firstDataIsFresh = Boolean(firstData && !query.isPlaceholderData);
  const firstSignature = firstData
    ? `${query.dataUpdatedAt}:${firstData.snapshotId}:${firstData.sourceRevision}`
    : null;

  useEffect(() => {
    if (!firstDataIsFresh || !firstData || firstSignature == null || query.isFetching) return;
    if (syncedSignatureRef.current === firstSignature) return;
    syncedSignatureRef.current = firstSignature;
    const runId = ++runIdRef.current;
    let cancelled = false;
    const initial = firstData;
    let items = [...initial.items];
    let cursor = initial.nextCursor;
    let previousCursor = -1;

    setMergedData({ ...initial, items, nextCursor: cursor });
    setAppendError(null);
    setIsComplete(cursor == null);
    if (cursor == null) return;

    setIsAppending(true);
    void (async () => {
      try {
        while (!cancelled && runId === runIdRef.current && cursor != null) {
          const nextCursor = Number(cursor);
          if (!Number.isInteger(nextCursor) || nextCursor <= previousCursor) {
            throw new Error('生産日程のページ情報が不正です。再読み込みしてください。');
          }
          const page = await getKioskGrindingPlanningBoard({
            ...stableParams!,
            cursor: nextCursor,
            pageSize: 160,
            snapshotId: initial.snapshotId
          });
          if (cancelled || runId !== runIdRef.current) return;
          if (
            page.snapshotId !== initial.snapshotId ||
            page.sourceRevision !== initial.sourceRevision ||
            page.siteKey !== initial.siteKey ||
            page.category !== initial.category ||
            page.view !== initial.view
          ) {
            throw new Error('表示中の生産日程が更新されました。再読み込みしてください。');
          }
          const seen = new Set(items.map((item) => item.itemId));
          const pageItems = page.items.filter((item) => {
            if (seen.has(item.itemId)) throw new Error('生産日程のページに重複があります。再読み込みしてください。');
            seen.add(item.itemId);
            return true;
          });
          items = [...items, ...pageItems];
          previousCursor = nextCursor;
          cursor = page.nextCursor;
          setMergedData((current) => current?.snapshotId === initial.snapshotId
            ? { ...initial, items, nextCursor: cursor }
            : current);
          setIsComplete(cursor == null);
        }
      } catch (error) {
        if (!cancelled && runId === runIdRef.current) {
          setAppendError(normalizeLeaderboardContinueFailure(error));
          setIsComplete(false);
        }
      } finally {
        if (!cancelled && runId === runIdRef.current) setIsAppending(false);
      }
    })();
    return () => {
      cancelled = true;
      syncedSignatureRef.current = null;
      if (runId === runIdRef.current) setIsAppending(false);
    };
  }, [firstData, firstDataIsFresh, firstSignature, query.isFetching, stableParams]);

  const displayData = mergedData ?? firstData;
  const scopeReady = Boolean(
    firstData && !query.isPlaceholderData && !query.isFetching && mergedData?.snapshotId === firstData.snapshotId
  );
  return {
    data: displayData,
    isLoading: query.isLoading,
    isFetching: query.isFetching,
    isError: query.isError,
    error: query.error,
    isPlaceholderData: query.isPlaceholderData,
    refetch: query.refetch,
    scopeReady,
    isAppending,
    isComplete: scopeReady && isComplete,
    appendError,
  };
}

export function useKioskGrindingPlanningBoardSnapshot(
  params: KioskGrindingPlanningBoardQuery | undefined,
  options?: { enabled?: boolean; refetchIntervalMs?: number | false; refetchOnWindowFocus?: boolean }
) {
  return useQuery({
    queryKey: ['kiosk-grinding-planning-board', 'snapshot', params],
    queryFn: () => getKioskGrindingPlanningBoardSnapshot(params!),
    enabled: (options?.enabled ?? true) && Boolean(params),
    refetchInterval: options?.refetchIntervalMs ?? 30000,
    refetchOnWindowFocus: options?.refetchOnWindowFocus ?? true
  });
}

export function useUpdateKioskGrindingPlanningBoardOverrides() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (payload: GrindingPlanningBoardOverridesRequest) => updateKioskGrindingPlanningBoardOverrides(payload),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['kiosk-grinding-planning-board'] });
    }
  });
}

export function useUpdateKioskGrindingPlanningBoardRank() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (payload: GrindingPlanningBoardRankRequest) => updateKioskGrindingPlanningBoardRank(payload),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['kiosk-grinding-planning-board'] });
    }
  });
}

export function useUpdateKioskGrindingPlanningBoardSeibanOrder() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (payload: GrindingPlanningBoardSeibanOrderRequest) => updateKioskGrindingPlanningBoardSeibanOrder(payload),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['kiosk-grinding-planning-board'] });
    }
  });
}

export function useKioskProductionScheduleSeibanMachineNames(
  fseibans: readonly string[],
  options?: { pauseRefetch?: boolean; enabled?: boolean }
) {
  const sortedUnique = useMemo(() => {
    const set = new Set<string>();
    for (const s of fseibans) {
      const t = s.trim();
      if (t.length > 0) {
        set.add(t);
      }
    }
    return [...set].sort((a, b) => a.localeCompare(b, 'ja'));
  }, [fseibans]);

  const keyFingerprint = sortedUnique.length === 0 ? '' : sortedUnique.join('\u0001');

  return useQuery({
    queryKey: ['kiosk-production-schedule-seiban-machine-names', keyFingerprint],
    queryFn: () => postKioskProductionScheduleSeibanMachineNames({ fseibans: sortedUnique }),
    enabled: (options?.enabled ?? true) && sortedUnique.length > 0,
    refetchInterval: options?.pauseRefetch ? false : 30000
  });
}

type DueManagementFilterContext = {
  resourceCd?: string;
  resourceCategory?: 'grinding' | 'cutting';
};

export function useKioskProductionScheduleDueManagementSummary(context?: DueManagementFilterContext) {
  return useQuery({
    queryKey: ['kiosk-production-schedule-due-management-summary', context],
    queryFn: () => getKioskProductionScheduleDueManagementSummary(context),
    refetchInterval: 30000
  });
}

export function useKioskProductionScheduleDueManagementTriage(context?: DueManagementFilterContext) {
  return useQuery({
    queryKey: ['kiosk-production-schedule-due-management-triage', context],
    queryFn: () => getKioskProductionScheduleDueManagementTriage(context),
    refetchInterval: 30000
  });
}

export function useKioskProductionScheduleDueManagementDailyPlan(context?: DueManagementFilterContext) {
  return useQuery({
    queryKey: ['kiosk-production-schedule-due-management-daily-plan', context],
    queryFn: () => getKioskProductionScheduleDueManagementDailyPlan(context),
    refetchInterval: 30000
  });
}

export function useKioskProductionScheduleDueManagementSeibanDetail(
  fseiban: string | null,
  context?: DueManagementFilterContext
) {
  return useQuery({
    queryKey: ['kiosk-production-schedule-due-management-seiban', fseiban, context],
    queryFn: () => getKioskProductionScheduleDueManagementSeibanDetail(fseiban ?? '', context),
    enabled: typeof fseiban === 'string' && fseiban.trim().length > 0
  });
}

export function useKioskGrindingPlanningBoardDueDetail(fseiban: string | null) {
  return useQuery({
    queryKey: ['kiosk-grinding-planning-board-due-detail', fseiban],
    queryFn: () => getKioskGrindingPlanningBoardDueDetail(fseiban ?? ''),
    enabled: typeof fseiban === 'string' && fseiban.trim().length > 0,
    refetchOnWindowFocus: false
  });
}

export function useKioskProductionScheduleProgressOverview() {
  return useQuery({
    queryKey: ['kiosk-production-schedule-progress-overview'],
    queryFn: getKioskProductionScheduleProgressOverview,
    refetchInterval: 300000
  });
}

export function useUpdateKioskProductionScheduleDueManagementSeibanDueDate() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ fseiban, dueDate }: { fseiban: string; dueDate: string }) =>
      updateKioskProductionScheduleDueManagementSeibanDueDate(fseiban, { dueDate }),
    onSuccess: (_data, variables) => {
      void queryClient.invalidateQueries({ queryKey: ['kiosk-production-schedule-due-management-summary'] });
      void queryClient.invalidateQueries({
        queryKey: ['kiosk-production-schedule-due-management-seiban', variables.fseiban]
      });
      void queryClient.invalidateQueries({ queryKey: ['kiosk-production-schedule'] });
    }
  });
}

export function useUpdateKioskProductionScheduleDueManagementSeibanProcessingDueDate() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      fseiban,
      processingType,
      dueDate
    }: {
      fseiban: string;
      processingType: string;
      dueDate: string;
    }) => updateKioskProductionScheduleDueManagementSeibanProcessingDueDate(fseiban, processingType, { dueDate }),
    onSuccess: (_data, variables) => {
      void queryClient.invalidateQueries({ queryKey: ['kiosk-production-schedule-due-management-summary'] });
      void queryClient.invalidateQueries({
        queryKey: ['kiosk-production-schedule-due-management-seiban', variables.fseiban]
      });
      void queryClient.invalidateQueries({ queryKey: ['kiosk-production-schedule'] });
    }
  });
}

export function useUpdateKioskGrindingPlanningBoardDueScope() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      fseiban,
      payload
    }: {
      fseiban: string;
      payload: GrindingPlanningBoardDueScopeRequest;
    }) => updateKioskGrindingPlanningBoardDueScope(fseiban, payload),
    onSuccess: (_data, variables) => {
      void queryClient.invalidateQueries({ queryKey: ['kiosk-grinding-planning-board-due-detail', variables.fseiban] });
      void queryClient.invalidateQueries({ queryKey: ['kiosk-grinding-planning-board'] });
    }
  });
}

export function useUpdateKioskProductionScheduleDueManagementPartPriorities() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ fseiban, orderedFhincds }: { fseiban: string; orderedFhincds: string[] }) =>
      updateKioskProductionScheduleDueManagementPartPriorities(fseiban, { orderedFhincds }),
    onSuccess: (_data, variables) => {
      void queryClient.invalidateQueries({
        queryKey: ['kiosk-production-schedule-due-management-seiban', variables.fseiban]
      });
      void queryClient.invalidateQueries({ queryKey: ['kiosk-production-schedule-due-management-summary'] });
    }
  });
}

export function useUpdateKioskProductionScheduleDueManagementPartProcessingType() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      fseiban,
      fhincd,
      processingType
    }: {
      fseiban: string;
      fhincd: string;
      processingType: string;
    }) => updateKioskProductionScheduleDueManagementPartProcessingType(fseiban, fhincd, { processingType }),
    onSuccess: (_data, variables) => {
      void queryClient.invalidateQueries({
        queryKey: ['kiosk-production-schedule-due-management-seiban', variables.fseiban]
      });
      void queryClient.invalidateQueries({ queryKey: ['kiosk-production-schedule'] });
    }
  });
}

export function useUpdateKioskProductionScheduleDueManagementPartNote() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ fseiban, fhincd, note }: { fseiban: string; fhincd: string; note: string }) =>
      updateKioskProductionScheduleDueManagementPartNote(fseiban, fhincd, { note }),
    onSuccess: (_data, variables) => {
      void queryClient.invalidateQueries({
        queryKey: ['kiosk-production-schedule-due-management-seiban', variables.fseiban]
      });
      void queryClient.invalidateQueries({ queryKey: ['kiosk-production-schedule'] });
    }
  });
}

export function useUpdateKioskProductionScheduleDueManagementTriageSelection() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ selectedFseibans }: { selectedFseibans: string[] }) =>
      updateKioskProductionScheduleDueManagementTriageSelection({ selectedFseibans }),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: ['kiosk-production-schedule-due-management-triage']
      });
      void queryClient.invalidateQueries({
        queryKey: ['kiosk-production-schedule-due-management-daily-plan']
      });
    }
  });
}

export function useUpdateKioskProductionScheduleDueManagementDailyPlan() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ orderedFseibans }: { orderedFseibans: string[] }) =>
      updateKioskProductionScheduleDueManagementDailyPlan({ orderedFseibans }),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: ['kiosk-production-schedule-due-management-daily-plan']
      });
      void queryClient.invalidateQueries({
        queryKey: ['kiosk-production-schedule-due-management-triage']
      });
    }
  });
}

type DueManagementTargetContext = {
  targetLocation?: string;
  rankingScope?: 'globalShared' | 'locationScoped' | 'localTemporary';
  resourceCd?: string;
  resourceCategory?: 'grinding' | 'cutting';
};

export function useKioskProductionScheduleDueManagementGlobalRank(context?: DueManagementTargetContext) {
  return useQuery({
    queryKey: ['kiosk-production-schedule-due-management-global-rank', context],
    queryFn: () => getKioskProductionScheduleDueManagementGlobalRank(context),
    refetchInterval: 30000
  });
}

export function useKioskProductionScheduleDueManagementManualOrderOverview(
  context?: DueManagementTargetContext & {
    siteKey?: string;
    deviceScopeKey?: string;
  },
  options?: { enabled?: boolean }
) {
  return useQuery({
    queryKey: ['kiosk-production-schedule-due-management-manual-order-overview', context],
    queryFn: () => getKioskProductionScheduleDueManagementManualOrderOverview(context),
    refetchInterval: 30000,
    enabled: options?.enabled ?? true
  });
}

export function useKioskProductionScheduleManualOrderSiteDevices(
  siteKey: string | undefined,
  options?: { enabled?: boolean; refetchIntervalMs?: number | false }
) {
  const interval = options?.refetchIntervalMs === undefined ? false : options.refetchIntervalMs;
  return useQuery({
    queryKey: ['kiosk-production-schedule-manual-order-site-devices', siteKey],
    queryFn: () => getKioskProductionScheduleManualOrderSiteDevices(siteKey!),
    enabled: (options?.enabled ?? true) && Boolean(siteKey && siteKey.trim().length > 0),
    refetchInterval: interval
  });
}

export function useKioskProductionScheduleManualOrderResourceAssignments(
  siteKey: string | undefined,
  options?: { enabled?: boolean; refetchIntervalMs?: number | false }
) {
  const interval =
    options?.refetchIntervalMs === undefined
      ? 30000
      : options.refetchIntervalMs === false
        ? false
        : options.refetchIntervalMs;
  return useQuery({
    queryKey: ['kiosk-production-schedule-manual-order-resource-assignments', siteKey],
    queryFn: () => getKioskProductionScheduleManualOrderResourceAssignments(siteKey!),
    enabled: (options?.enabled ?? true) && Boolean(siteKey && siteKey.trim().length > 0),
    refetchInterval: interval
  });
}

export function useUpdateKioskProductionScheduleManualOrderResourceAssignments() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationKey: ['kiosk-production-schedule', 'write', 'manual-order-resource-assignments'],
    mutationFn: (payload: { siteKey: string; deviceScopeKey: string; resourceCds: string[] }) =>
      putKioskProductionScheduleManualOrderResourceAssignments(payload),
    onSuccess: (_data, variables) => {
      void queryClient.invalidateQueries({
        queryKey: ['kiosk-production-schedule-manual-order-resource-assignments', variables.siteKey]
      });
      void queryClient.invalidateQueries({ queryKey: ['kiosk-production-schedule-due-management-manual-order-overview'] });
    }
  });
}

export function useUpdateKioskProductionScheduleDueManagementGlobalRank() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (payload: { orderedFseibans: string[]; targetLocation?: string; rankingScope?: 'globalShared' | 'locationScoped' | 'localTemporary' }) =>
      updateKioskProductionScheduleDueManagementGlobalRank(payload),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: ['kiosk-production-schedule-due-management-global-rank']
      });
      void queryClient.invalidateQueries({
        queryKey: ['kiosk-production-schedule-due-management-daily-plan']
      });
    }
  });
}

export function useKioskProductionScheduleDueManagementGlobalRankProposal(context?: DueManagementTargetContext) {
  return useQuery({
    queryKey: ['kiosk-production-schedule-due-management-global-rank-proposal', context],
    queryFn: () => getKioskProductionScheduleDueManagementGlobalRankProposal(context),
    refetchInterval: 30000
  });
}

export function useAutoGenerateKioskProductionScheduleDueManagementGlobalRank() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (payload?: { minCandidateCount?: number; maxReorderDeltaRatio?: number; keepExistingTail?: boolean; targetLocation?: string; rankingScope?: 'globalShared' | 'locationScoped' | 'localTemporary' }) =>
      autoGenerateKioskProductionScheduleDueManagementGlobalRank(payload),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: ['kiosk-production-schedule-due-management-global-rank']
      });
      void queryClient.invalidateQueries({
        queryKey: ['kiosk-production-schedule-due-management-global-rank-proposal']
      });
      void queryClient.invalidateQueries({
        queryKey: ['kiosk-production-schedule-due-management-daily-plan']
      });
    }
  });
}

export function useProductionScheduleResourceCategorySettings(location: string) {
  return useQuery({
    queryKey: ['production-schedule-resource-category-settings', location],
    queryFn: () => getProductionScheduleResourceCategorySettings(location),
    enabled: location.trim().length > 0
  });
}

export function useProductionScheduleDueManagementAccessPasswordSettings(location: string) {
  return useQuery({
    queryKey: ['production-schedule-due-management-access-password-settings', location],
    queryFn: () => getProductionScheduleDueManagementAccessPasswordSettings(location),
    enabled: location.trim().length > 0
  });
}

export function useProductionScheduleOrderSplitPilotSettings() {
  return useQuery({
    queryKey: ['production-schedule-order-split-pilot-settings'],
    queryFn: getProductionScheduleOrderSplitPilotSettings
  });
}

export function useProductionScheduleProcessingTypeOptions(location: string) {
  return useQuery({
    queryKey: ['production-schedule-processing-type-options', location],
    queryFn: () => getProductionScheduleProcessingTypeOptions(location),
    enabled: location.trim().length > 0
  });
}

export function useProductionScheduleResourceCodeMappings(location: string) {
  return useQuery({
    queryKey: ['production-schedule-resource-code-mappings', location],
    queryFn: () => getProductionScheduleResourceCodeMappings(location),
    enabled: location.trim().length > 0
  });
}

export function useUpdateProductionScheduleResourceCategorySettings() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (payload: { location: string; cuttingExcludedResourceCds: string[] }) =>
      updateProductionScheduleResourceCategorySettings(payload),
    onSuccess: (settings) => {
      void queryClient.invalidateQueries({ queryKey: ['production-schedule-resource-category-settings', settings.location] });
      void queryClient.invalidateQueries({ queryKey: ['kiosk-production-schedule-resources'] });
      void queryClient.invalidateQueries({ queryKey: ['kiosk-production-schedule-progress-overview'] });
      void queryClient.invalidateQueries({ queryKey: ['kiosk-production-schedule'] });
      void queryClient.invalidateQueries({ queryKey: ['kiosk-production-schedule-due-management-summary'] });
    }
  });
}

export function useUpdateProductionScheduleDueManagementAccessPassword() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (payload: { location: string; password: string }) => updateProductionScheduleDueManagementAccessPassword(payload),
    onSuccess: (settings) => {
      void queryClient.invalidateQueries({
        queryKey: ['production-schedule-due-management-access-password-settings', settings.location]
      });
    }
  });
}

export function useUpdateProductionScheduleOrderSplitPilotSettings() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (payload: { enabled: boolean }) => updateProductionScheduleOrderSplitPilotSettings(payload),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['production-schedule-order-split-pilot-settings'] });
      void queryClient.invalidateQueries({ queryKey: ['kiosk-production-schedule-order-split-status'] });
      void queryClient.invalidateQueries({ queryKey: ['kiosk-production-schedule'] });
      void queryClient.invalidateQueries({ queryKey: ['kiosk-production-schedule-leaderboard-shell'] });
      void queryClient.invalidateQueries({ queryKey: ['kiosk-production-schedule-leaderboard-board'] });
    }
  });
}

export function useKioskProductionScheduleOrderSplitStatus() {
  return useQuery({
    queryKey: ['kiosk-production-schedule-order-split-status'],
    queryFn: getKioskProductionScheduleOrderSplitStatus,
    refetchInterval: 15000
  });
}

export function useUpdateProductionScheduleProcessingTypeOptions() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (payload: { location: string; options: Array<{ code: string; label: string; priority: number; enabled: boolean }> }) =>
      updateProductionScheduleProcessingTypeOptions(payload),
    onSuccess: (settings) => {
      void queryClient.invalidateQueries({ queryKey: ['production-schedule-processing-type-options', settings.location] });
      void queryClient.invalidateQueries({ queryKey: ['kiosk-production-schedule-processing-type-options'] });
    }
  });
}

export function useUpdateProductionScheduleResourceCodeMappings() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (payload: {
      location: string;
      mappings: Array<{ fromResourceCd: string; toResourceCd: string; priority: number; enabled: boolean }>;
    }) => updateProductionScheduleResourceCodeMappings(payload),
    onSuccess: (settings) => {
      void queryClient.invalidateQueries({ queryKey: ['production-schedule-resource-code-mappings', settings.location] });
      void queryClient.invalidateQueries({ queryKey: ['kiosk-production-schedule'] });
      void queryClient.invalidateQueries({ queryKey: ['kiosk-production-schedule-due-management-summary'] });
      void queryClient.invalidateQueries({ queryKey: ['kiosk-production-schedule-due-management-seiban-detail'] });
    }
  });
}

export function useImportProductionScheduleResourceCodeMappingsFromCsv() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (payload: { location: string; csvText: string; dryRun: boolean }) =>
      importProductionScheduleResourceCodeMappingsFromCsv(payload),
    onSuccess: (_result, variables) => {
      void queryClient.invalidateQueries({ queryKey: ['production-schedule-resource-code-mappings', variables.location] });
      void queryClient.invalidateQueries({ queryKey: ['kiosk-production-schedule'] });
      void queryClient.invalidateQueries({ queryKey: ['kiosk-production-schedule-due-management-summary'] });
      void queryClient.invalidateQueries({ queryKey: ['kiosk-production-schedule-due-management-seiban-detail'] });
    }
  });
}

export function useProductionScheduleLoadBalancingCapacityBase(location: string) {
  return useQuery({
    queryKey: ['production-schedule-load-balancing-capacity-base', location],
    queryFn: () => getProductionScheduleLoadBalancingCapacityBase(location),
    enabled: location.trim().length > 0
  });
}

export function useProductionScheduleLoadBalancingMonthlyCapacity(location: string, yearMonth: string) {
  return useQuery({
    queryKey: ['production-schedule-load-balancing-monthly-capacity', location, yearMonth],
    queryFn: () => getProductionScheduleLoadBalancingMonthlyCapacity(location, yearMonth.trim()),
    enabled: location.trim().length > 0 && /^\d{4}-\d{2}$/.test(yearMonth.trim())
  });
}

export function useProductionScheduleLoadBalancingClasses(location: string) {
  return useQuery({
    queryKey: ['production-schedule-load-balancing-classes', location],
    queryFn: () => getProductionScheduleLoadBalancingClasses(location),
    enabled: location.trim().length > 0
  });
}

export function useProductionScheduleLoadBalancingTransferRules(location: string) {
  return useQuery({
    queryKey: ['production-schedule-load-balancing-transfer-rules', location],
    queryFn: () => getProductionScheduleLoadBalancingTransferRules(location),
    enabled: location.trim().length > 0
  });
}

export function useProductionScheduleLoadBalancingWorkCalendars(location: string) {
  return useQuery({
    queryKey: ['production-schedule-load-balancing-work-calendars', location],
    queryFn: () => getProductionScheduleLoadBalancingWorkCalendars(location),
    enabled: location.trim().length > 0
  });
}

export function useUpdateProductionScheduleLoadBalancingCapacityBase() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: updateProductionScheduleLoadBalancingCapacityBase,
    onSuccess: (_settings, variables) => {
      void queryClient.invalidateQueries({
        queryKey: ['production-schedule-load-balancing-capacity-base', variables.location]
      });
      void queryClient.invalidateQueries({ queryKey: ['kiosk-production-schedule-load-balancing-overview'] });
      void queryClient.invalidateQueries({
        queryKey: ['kiosk-production-schedule-load-balancing-machine-monthly-load']
      });
      void queryClient.invalidateQueries({
        queryKey: ['kiosk-production-schedule-load-balancing-start-date-leveling']
      });
    }
  });
}

export function useUpdateProductionScheduleLoadBalancingMonthlyCapacity() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: updateProductionScheduleLoadBalancingMonthlyCapacity,
    onSuccess: (_settings, variables) => {
      void queryClient.invalidateQueries({
        queryKey: ['production-schedule-load-balancing-monthly-capacity', variables.location, variables.yearMonth]
      });
      void queryClient.invalidateQueries({ queryKey: ['kiosk-production-schedule-load-balancing-overview'] });
      void queryClient.invalidateQueries({
        queryKey: ['kiosk-production-schedule-load-balancing-machine-monthly-load']
      });
      void queryClient.invalidateQueries({
        queryKey: ['kiosk-production-schedule-load-balancing-start-date-leveling']
      });
    }
  });
}

export function useUpdateProductionScheduleLoadBalancingClasses() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: updateProductionScheduleLoadBalancingClasses,
    onSuccess: (_settings, variables) => {
      void queryClient.invalidateQueries({
        queryKey: ['production-schedule-load-balancing-classes', variables.location]
      });
      void queryClient.invalidateQueries({ queryKey: ['kiosk-production-schedule-load-balancing-overview'] });
      void queryClient.invalidateQueries({
        queryKey: ['kiosk-production-schedule-load-balancing-machine-monthly-load']
      });
      void queryClient.invalidateQueries({
        queryKey: ['kiosk-production-schedule-load-balancing-start-date-leveling']
      });
    }
  });
}

export function useUpdateProductionScheduleLoadBalancingTransferRules() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: updateProductionScheduleLoadBalancingTransferRules,
    onSuccess: (_settings, variables) => {
      void queryClient.invalidateQueries({
        queryKey: ['production-schedule-load-balancing-transfer-rules', variables.location]
      });
      void queryClient.invalidateQueries({ queryKey: ['kiosk-production-schedule-load-balancing-overview'] });
      void queryClient.invalidateQueries({
        queryKey: ['kiosk-production-schedule-load-balancing-machine-monthly-load']
      });
      void queryClient.invalidateQueries({
        queryKey: ['kiosk-production-schedule-load-balancing-start-date-leveling']
      });
    }
  });
}

export function useUpdateProductionScheduleLoadBalancingWorkCalendars() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: updateProductionScheduleLoadBalancingWorkCalendars,
    onSuccess: (_settings, variables) => {
      void queryClient.invalidateQueries({
        queryKey: ['production-schedule-load-balancing-work-calendars', variables.location]
      });
      void queryClient.invalidateQueries({
        queryKey: ['kiosk-production-schedule-load-balancing-start-date-leveling']
      });
    }
  });
}

export function useKioskProductionScheduleLoadBalancingOverview(
  params: { month: string; targetDeviceScopeKey?: string },
  options?: { enabled?: boolean }
) {
  const monthOk = /^\d{4}-\d{2}$/.test(params.month.trim());
  return useQuery({
    queryKey: ['kiosk-production-schedule-load-balancing-overview', params],
    queryFn: () => getKioskProductionScheduleLoadBalancingOverview(params),
    enabled: (options?.enabled ?? true) && monthOk,
    staleTime: 60_000,
    placeholderData: (previousData) => previousData
  });
}

export function usePostKioskProductionScheduleLoadBalancingSuggestions() {
  return useMutation({
    mutationFn: postKioskProductionScheduleLoadBalancingSuggestions
  });
}

export function usePostKioskProductionScheduleLoadBalancingOutsourcingCandidates() {
  return useMutation({
    mutationFn: postKioskProductionScheduleLoadBalancingOutsourcingCandidates
  });
}

export function usePostKioskProductionScheduleLoadBalancingOutsourcingSimulate() {
  return useMutation({
    mutationFn: postKioskProductionScheduleLoadBalancingOutsourcingSimulate
  });
}

export function usePostKioskProductionScheduleLoadBalancingOutsourcingPlan() {
  return useMutation({
    mutationFn: postKioskProductionScheduleLoadBalancingOutsourcingPlan
  });
}

export function usePostKioskProductionScheduleLoadBalancingOutsourcingReplacements() {
  return useMutation({
    mutationFn: postKioskProductionScheduleLoadBalancingOutsourcingReplacements
  });
}

export function useKioskProductionScheduleLoadBalancingMachineMonthlyLoad(
  params: {
    fromMonth: string;
    toMonth: string;
    targetDeviceScopeKey?: string;
    machineName?: string;
    fhincd?: string;
  },
  options?: { enabled?: boolean }
) {
  const monthOk = /^\d{4}-\d{2}$/.test(params.fromMonth.trim()) && /^\d{4}-\d{2}$/.test(params.toMonth.trim());
  return useQuery({
    queryKey: ['kiosk-production-schedule-load-balancing-machine-monthly-load', params],
    queryFn: () => getKioskProductionScheduleLoadBalancingMachineMonthlyLoad(params),
    enabled: (options?.enabled ?? true) && monthOk,
    staleTime: 120_000,
    placeholderData: (previousData) => previousData
  });
}

export function useKioskProductionScheduleLoadBalancingStartDateLeveling(
  params: {
    fromMonth: string;
    toMonth: string;
    bucket: 'month' | 'day';
    focusMonth?: string;
    targetDeviceScopeKey?: string;
    resourceCd?: string;
  },
  options?: { enabled?: boolean }
) {
  const monthOk = /^\d{4}-\d{2}$/.test(params.fromMonth.trim()) && /^\d{4}-\d{2}$/.test(params.toMonth.trim());
  const focusOk =
    params.bucket !== 'day' ||
    (params.focusMonth != null && /^\d{4}-\d{2}$/.test(params.focusMonth.trim()));
  return useQuery({
    queryKey: ['kiosk-production-schedule-load-balancing-start-date-leveling', params],
    queryFn: () => getKioskProductionScheduleLoadBalancingStartDateLeveling(params),
    enabled: (options?.enabled ?? true) && monthOk && focusOk,
    staleTime: 120_000,
    placeholderData: (previousData) => previousData
  });
}

export function usePostKioskProductionScheduleLoadBalancingStartDateLevelingSimulate() {
  return useMutation({
    mutationFn: postKioskProductionScheduleLoadBalancingStartDateLevelingSimulate
  });
}

export function useVerifyKioskDueManagementAccessPassword() {
  return useMutation({
    mutationFn: (payload: { password: string }) => verifyKioskDueManagementAccessPassword(payload)
  });
}

export function useUpdateKioskProductionScheduleSearchState() {
  return useMutation({
    mutationKey: ['kiosk-production-schedule', 'write', 'search-state'],
    mutationFn: (state: Parameters<typeof setKioskProductionScheduleSearchState>[0]) =>
      setKioskProductionScheduleSearchState(state),
  });
}

export function useUpdateKioskProductionScheduleSearchHistory() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationKey: ['kiosk-production-schedule', 'write', 'search-history'],
    mutationFn: (history: Parameters<typeof setKioskProductionScheduleSearchHistory>[0]) =>
      setKioskProductionScheduleSearchHistory(history),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['kiosk-production-schedule-search-history'] });
    }
  });
}

export type KioskProductionScheduleOrderCachePolicy =
  | 'default'
  | 'leaderBoardFastPath'
  | 'manualOrderOptimistic';

export type UpdateKioskProductionScheduleOrderVariables = {
  rowId: string;
  payload: {
    resourceCd: string;
    orderNumber: number | null;
    targetLocation?: string;
    targetDeviceScopeKey?: string;
  };
  cachePolicy?: KioskProductionScheduleOrderCachePolicy;
};

type ProductionScheduleOrderRollbackContext = {
  scheduleSnapshots: ReadonlyArray<[QueryKey, unknown]>;
  usageSnapshots: ReadonlyArray<[QueryKey, unknown]>;
};

function normalizeTargetDeviceScopeKey(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : undefined;
}

function matchesScheduleListScope(queryKey: QueryKey, targetDeviceScopeKey: string | undefined): boolean {
  const params = queryKey[1];
  if (!params || typeof params !== 'object' || Array.isArray(params)) return false;
  const cacheScope = normalizeTargetDeviceScopeKey(
    (params as { targetDeviceScopeKey?: unknown }).targetDeviceScopeKey
  );
  return cacheScope === targetDeviceScopeKey;
}

function matchesOrderUsageScope(queryKey: QueryKey, targetDeviceScopeKey: string | undefined): boolean {
  if (queryKey.length < 3) return false;
  return normalizeTargetDeviceScopeKey(queryKey[2]) === targetDeviceScopeKey;
}

type ProductionScheduleOrderCachePatchVariables = {
  rowId: string;
  payload: UpdateKioskProductionScheduleOrderVariables['payload'];
  cachePolicy?: KioskProductionScheduleOrderCachePolicy;
};

function patchOrderCachesOptimistically(
  queryClient: ReturnType<typeof useQueryClient>,
  variables: ProductionScheduleOrderCachePatchVariables
): ProductionScheduleOrderRollbackContext | undefined {
  // NOTE: cancelQueries は「進行中の取得」と「更新」が競合しやすい場面で有効。
  //       ただし await すると、取得側が即時キャンセルに対応していない場合に体感待ちを作るため、
  //       ここでは await せず投げっぱなしにする（更新完了後に invalidate で整合を取る）。
  void queryClient.cancelQueries({ queryKey: ['kiosk-production-schedule'] });
  void queryClient.cancelQueries({ queryKey: ['kiosk-production-schedule-order-usage'] });

  const policy = variables.cachePolicy ?? 'default';
  if (policy !== 'leaderBoardFastPath' && policy !== 'manualOrderOptimistic') {
    return undefined;
  }

  const targetDeviceScopeKey = normalizeTargetDeviceScopeKey(variables.payload.targetDeviceScopeKey);
  const allScheduleSnapshots = queryClient.getQueriesData({
    queryKey: ['kiosk-production-schedule']
  });
  const allUsageSnapshots = queryClient.getQueriesData({
    queryKey: ['kiosk-production-schedule-order-usage']
  });
  const scheduleSnapshots =
    policy === 'manualOrderOptimistic'
      ? allScheduleSnapshots.filter(([queryKey]) => matchesScheduleListScope(queryKey, targetDeviceScopeKey))
      : allScheduleSnapshots;
  const usageSnapshots =
    policy === 'manualOrderOptimistic'
      ? allUsageSnapshots.filter(([queryKey]) => matchesOrderUsageScope(queryKey, targetDeviceScopeKey))
      : allUsageSnapshots;

  let previousOrder: number | null = null;
  let rowFoundInScheduleCache = false;
  for (const [, data] of scheduleSnapshots) {
    if (!data || typeof data !== 'object' || !('rows' in data)) continue;
    const rows = (data as KioskProductionScheduleListCache).rows;
    if (!Array.isArray(rows) || !rows.some((row) => row.id === variables.rowId)) continue;
    rowFoundInScheduleCache = true;
    previousOrder = findProcessingOrderForRow(rows, variables.rowId);
    break;
  }

  const nextOrder = variables.payload.orderNumber;
  const resourceCd = variables.payload.resourceCd;

  if (policy === 'manualOrderOptimistic') {
    for (const [queryKey] of scheduleSnapshots) {
      queryClient.setQueryData<KioskProductionScheduleListCache>(queryKey, (old) => {
        if (!old) return old;
        return patchScheduleListProcessingOrder(old, variables.rowId, nextOrder);
      });
    }
  } else {
    queryClient.setQueriesData<KioskProductionScheduleListCache>(
      { queryKey: ['kiosk-production-schedule'] },
      (old) => {
        if (!old) return old;
        return patchScheduleListProcessingOrder(old, variables.rowId, nextOrder);
      }
    );
  }

  // usage は「一覧キャッシュ上で当該行を特定できたとき」だけ楽観パッチする。
  // 行が無いのに next だけ足すと占有表示がズレうる（ロールバックで一覧は戻るが usage は誤り得る）。
  if (rowFoundInScheduleCache) {
    if (policy === 'manualOrderOptimistic') {
      for (const [queryKey] of usageSnapshots) {
        queryClient.setQueryData<Record<string, number[]>>(queryKey, (old) => {
          if (!old) return old;
          return patchOrderUsageForProcessingOrderChange(old, resourceCd, previousOrder, nextOrder);
        });
      }
    } else {
      queryClient.setQueriesData<Record<string, number[]>>(
        { queryKey: ['kiosk-production-schedule-order-usage'] },
        (old) => {
          if (!old) return old;
          return patchOrderUsageForProcessingOrderChange(old, resourceCd, previousOrder, nextOrder);
        }
      );
    }
  }

  return { scheduleSnapshots, usageSnapshots };
}

function patchOrderCacheWithServerValue(
  queryClient: ReturnType<typeof useQueryClient>,
  data: { orderNumber?: number | null },
  variables: ProductionScheduleOrderCachePatchVariables
) {
  const policy = variables.cachePolicy ?? 'default';
  const serverOrder = data.orderNumber ?? null;
  if (policy === 'leaderBoardFastPath') {
    queryClient.setQueriesData<KioskProductionScheduleListCache>(
      { queryKey: ['kiosk-production-schedule'] },
      (old) => {
        if (!old) return old;
        return patchScheduleListProcessingOrder(old, variables.rowId, serverOrder);
      }
    );
    return;
  }
  if (policy !== 'manualOrderOptimistic') return;

  const targetDeviceScopeKey = normalizeTargetDeviceScopeKey(variables.payload.targetDeviceScopeKey);
  const scheduleCaches = queryClient.getQueriesData({
    queryKey: ['kiosk-production-schedule']
  });
  for (const [queryKey] of scheduleCaches) {
    if (!matchesScheduleListScope(queryKey, targetDeviceScopeKey)) continue;
    queryClient.setQueryData<KioskProductionScheduleListCache>(queryKey, (old) => {
      if (!old) return old;
      return patchScheduleListProcessingOrder(old, variables.rowId, serverOrder);
    });
  }
}

function rollbackOrderCaches(
  queryClient: ReturnType<typeof useQueryClient>,
  context: unknown
) {
  const rollback = context as ProductionScheduleOrderRollbackContext | undefined;
  if (!rollback) return;
  for (const [key, snap] of rollback.scheduleSnapshots) {
    queryClient.setQueryData(key, snap);
  }
  for (const [key, snap] of rollback.usageSnapshots) {
    queryClient.setQueryData(key, snap);
  }
}

export function useUpdateKioskProductionScheduleOrder() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationKey: ['kiosk-production-schedule', 'write', 'order'],
    mutationFn: ({ rowId, payload }: UpdateKioskProductionScheduleOrderVariables) =>
      updateKioskProductionScheduleOrder(rowId, payload),
    onMutate: (variables) => patchOrderCachesOptimistically(queryClient, variables),
    onSuccess: (data, variables) => {
      const policy = variables.cachePolicy ?? 'default';
      patchOrderCacheWithServerValue(queryClient, data, variables);
      if (policy === 'leaderBoardFastPath') return;
      // UI待ちを作らない（mutation完了は即返し、裏で再取得）
      void queryClient.invalidateQueries({ queryKey: ['kiosk-production-schedule'] });
      void queryClient.invalidateQueries({ queryKey: ['kiosk-production-schedule-order-usage'] });
      void queryClient.invalidateQueries({
        queryKey: ['kiosk-production-schedule-due-management-manual-order-overview']
      });
    },
    onError: (_err, variables, context) => {
      const policy = variables.cachePolicy ?? 'default';
      if (policy !== 'leaderBoardFastPath' && policy !== 'manualOrderOptimistic') return;
      rollbackOrderCaches(queryClient, context);
    }
  });
}

export function useUpdateKioskProductionScheduleNote() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationKey: ['kiosk-production-schedule', 'write', 'note'],
    mutationFn: ({ rowId, note }: { rowId: string; note: string }) =>
      updateKioskProductionScheduleNote(rowId, { note }),
    onMutate: () => {
      void queryClient.cancelQueries({ queryKey: ['kiosk-production-schedule'] });
    },
    onSuccess: async (data, { rowId }) => {
      queryClient.setQueriesData<{
        page: number;
        pageSize: number;
        total: number;
        rows: Array<{
          id: string;
          occurredAt: string | Date;
          rowData: unknown;
          processingOrder?: number | null;
          note?: string | null;
          dueDate?: string | null;
        }>;
      }>({ queryKey: ['kiosk-production-schedule'] }, (oldData) => {
        if (!oldData) return oldData;
        return {
          ...oldData,
          rows: oldData.rows.map((row) =>
            row.id === rowId ? { ...row, note: data.note } : row
          )
        };
      });
      void queryClient.invalidateQueries({ queryKey: ['kiosk-production-schedule'] });
    }
  });
}

export function useUpdateKioskProductionScheduleDueDate() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationKey: ['kiosk-production-schedule', 'write', 'due-date'],
    mutationFn: ({ rowId, dueDate }: { rowId: string; dueDate: string }) =>
      updateKioskProductionScheduleDueDate(rowId, { dueDate }),
    onMutate: () => {
      void queryClient.cancelQueries({ queryKey: ['kiosk-production-schedule'] });
    },
    onSuccess: async (data, { rowId }) => {
      queryClient.setQueriesData<{
        page: number;
        pageSize: number;
        total: number;
        rows: Array<{
          id: string;
          occurredAt: string | Date;
          rowData: unknown;
          processingOrder?: number | null;
          note?: string | null;
          dueDate?: string | null;
        }>;
      }>({ queryKey: ['kiosk-production-schedule'] }, (oldData) => {
        if (!oldData) return oldData;
        return {
          ...oldData,
          rows: oldData.rows.map((row) =>
            row.id === rowId ? { ...row, dueDate: data.dueDate } : row
          )
        };
      });
      void queryClient.invalidateQueries({ queryKey: ['kiosk-production-schedule'] });
    }
  });
}

export function useUpdateKioskProductionScheduleSplitOrder() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationKey: ['kiosk-production-schedule', 'write', 'split-order'],
    mutationFn: ({
      splitId,
      payload
    }: {
      splitId: string;
      payload: {
        resourceCd: string;
        orderNumber: number | null;
        targetLocation?: string;
        targetDeviceScopeKey?: string;
      };
      cachePolicy?: KioskProductionScheduleOrderCachePolicy;
    }) => updateKioskProductionScheduleSplitOrder(splitId, payload),
    onMutate: (variables) =>
      patchOrderCachesOptimistically(queryClient, {
        rowId: `split:${variables.splitId}`,
        payload: variables.payload,
        cachePolicy: variables.cachePolicy
      }),
    onSuccess: (data, variables) => {
      const policy = variables.cachePolicy ?? 'default';
      patchOrderCacheWithServerValue(queryClient, data, {
        rowId: `split:${variables.splitId}`,
        payload: variables.payload,
        cachePolicy: policy
      });
      if (policy === 'leaderBoardFastPath') return;
      void queryClient.invalidateQueries({ queryKey: ['kiosk-production-schedule'] });
      void queryClient.invalidateQueries({ queryKey: ['kiosk-production-schedule-order-usage'] });
      if (policy === 'manualOrderOptimistic') {
        void queryClient.invalidateQueries({
          queryKey: ['kiosk-production-schedule-due-management-manual-order-overview']
        });
      }
    },
    onError: (_err, variables, context) => {
      const policy = variables.cachePolicy ?? 'default';
      if (policy !== 'leaderBoardFastPath' && policy !== 'manualOrderOptimistic') return;
      rollbackOrderCaches(queryClient, context);
    }
  });
}

export function useUpdateKioskProductionScheduleSplitDueDate() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationKey: ['kiosk-production-schedule', 'write', 'split-due-date'],
    mutationFn: ({ splitId, dueDate }: { splitId: string; dueDate: string }) =>
      updateKioskProductionScheduleSplitDueDate(splitId, { dueDate }),
    onMutate: () => {
      void queryClient.cancelQueries({ queryKey: ['kiosk-production-schedule'] });
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['kiosk-production-schedule'] });
    }
  });
}

export function useUpdateKioskProductionScheduleProcessing() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationKey: ['kiosk-production-schedule', 'write', 'processing'],
    mutationFn: ({ rowId, processingType }: { rowId: string; processingType: string }) =>
      updateKioskProductionScheduleProcessing(rowId, { processingType }),
    onMutate: () => {
      void queryClient.cancelQueries({ queryKey: ['kiosk-production-schedule'] });
    },
    onSuccess: async (data, { rowId }) => {
      queryClient.setQueriesData<{
        page: number;
        pageSize: number;
        total: number;
        rows: Array<{
          id: string;
          occurredAt: string | Date;
          rowData: unknown;
          processingOrder?: number | null;
          processingType?: string | null;
          note?: string | null;
          dueDate?: string | null;
        }>;
      }>({ queryKey: ['kiosk-production-schedule'] }, (oldData) => {
        if (!oldData) return oldData;
        return {
          ...oldData,
          rows: oldData.rows.map((row) =>
            row.id === rowId ? { ...row, processingType: data.processingType } : row
          )
        };
      });
      void queryClient.invalidateQueries({ queryKey: ['kiosk-production-schedule'] });
    }
  });
}

export function useSetKioskProductionScheduleRowCompletion() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationKey: ['kiosk-production-schedule', 'write', 'completion'],
    mutationFn: (args: { rowId: string; intent: 'complete' | 'incomplete' }) =>
      setKioskProductionScheduleRowCompletion(args.rowId, args.intent),
    onMutate: () => {
      void queryClient.cancelQueries({ queryKey: ['kiosk-production-schedule'] });
      void queryClient.cancelQueries({ queryKey: ['kiosk-production-schedule-order-usage'] });
    },
    onSuccess: (data, variables) => {
      const { rowId } = variables;
      // Optimistic Update: キャッシュを直接更新して即座にUIを更新
      queryClient.setQueriesData<KioskProductionScheduleListCache>(
        { queryKey: ['kiosk-production-schedule'] },
        (oldData) => {
          if (!oldData) return oldData;
          return {
            ...oldData,
            rows: oldData.rows.map((row) =>
              row.id === rowId ? { ...row, rowData: data.rowData } : row
            )
          };
        }
      );
      // バックグラウンドで再取得（エラー時の整合性確保）
      void queryClient.invalidateQueries({ queryKey: ['kiosk-production-schedule'] });
      void queryClient.invalidateQueries({ queryKey: ['kiosk-production-schedule-order-usage'] });
      void queryClient.invalidateQueries({ queryKey: ['kiosk-production-schedule-history-progress'] });
      void queryClient.invalidateQueries({ queryKey: ['kiosk-production-schedule-progress-overview'] });
      void queryClient.invalidateQueries({
        queryKey: ['kiosk-production-schedule-due-management-manual-order-overview']
      });
    }
  });
}
