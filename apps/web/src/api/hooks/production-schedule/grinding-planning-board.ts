import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { isAxiosError } from 'axios';
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState
} from 'react';

import { normalizeLeaderboardContinueFailure } from '../../../features/kiosk/leaderOrderBoard/leaderboardContinueErrorPolicy';
import { LEADER_BOARD_LEADER_PHASED_STALE_MS, LEADER_BOARD_SCHEDULE_REFETCH_MS } from '../../../features/kiosk/leaderOrderBoard/performance/leaderBoardRefetchPolicy';
import {
  splitKioskSessakuPieces, mergeKioskSessakuPieces, setKioskSessakuPieceCompletion,
  getKioskGrindingPlanningBoardDueDetail,
  getKioskGrindingPlanningBoardProcessChips,
  getKioskGrindingPlanningBoardResourceCapacity,
  updateKioskGrindingPlanningBoardResourceCapacity,
  getKioskGrindingPlanningBoard,
  getKioskGrindingPlanningBoardLoad,
  getKioskGrindingPlanningBoardSnapshot,
  getKioskGrindingPlanningBoardSeibanCandidates,
  updateKioskGrindingPlanningBoardArrival,
  updateKioskGrindingPlanningBoardFirstProcessArrival,
  updateKioskGrindingPlanningBoardOverrides,
  updateKioskGrindingPlanningBoardPins,
  updateKioskGrindingPlanningBoardRank,
  updateKioskGrindingPlanningBoardResourceOrder,
  updateKioskGrindingPlanningBoardResourceOrderBulk,
  updateKioskGrindingPlanningBoardSeibanOrder,
  updateKioskGrindingPlanningBoardSeibanChecks,
  type KioskGrindingPlanningBoardQuery,
  updateKioskGrindingPlanningBoardDueScope
} from '../../client';
import { productionScheduleQueryKeys } from '../../queryKeys/productionSchedule';

import type {
  SessakuPiecesSplitRequest, SessakuPiecesMergeRequest, SessakuPieceCompletionRequest,
  GrindingPlanningBoardFirstProcessArrivalRequest,
  GrindingPlanningBoardArrivalRequest,
  GrindingPlanningBoardProcessChipsRequest,
  GrindingPlanningBoardResourceCapacityRequest,
  GrindingPlanningBoardResourceCapacityResponse,
  GrindingPlanningBoardOverridesRequest,
  GrindingPlanningBoardRankRequest,
  GrindingPlanningBoardRankResponse,
  GrindingPlanningBoardResourceOrderRequest,
  GrindingPlanningBoardResourceOrderBulkRequest,
  GrindingPlanningBoardPinsRequest,
  GrindingPlanningBoardResourceOrderResponse,
  GrindingPlanningBoardSeibanOrderRequest,
  GrindingPlanningBoardSeibanChecksRequest,
  GrindingPlanningBoardCategory,
  GrindingPlanningBoardResponse,
  GrindingPlanningBoardDueScopeRequest
} from '@raspi-system/shared-types';

export function useKioskGrindingPlanningBoardProcessChips(parts: GrindingPlanningBoardProcessChipsRequest['parts']) {
  return useQuery({
    queryKey: productionScheduleQueryKeys.grindingPlanningBoardProcessChips(parts),
    queryFn: () => getKioskGrindingPlanningBoardProcessChips({ parts }),
    enabled: parts.length > 0,
    placeholderData: keepPreviousData,
    refetchOnWindowFocus: false,
    refetchInterval: LEADER_BOARD_SCHEDULE_REFETCH_MS
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
    queryKey: productionScheduleQueryKeys.grindingPlanningBoard(params),
    queryFn: () => getKioskGrindingPlanningBoard(params!),
    enabled: (options?.enabled ?? true) && Boolean(params),
    refetchInterval: options?.refetchIntervalMs ?? 30000,
    staleTime: options?.staleTime,
    refetchOnWindowFocus: options?.refetchOnWindowFocus,
    placeholderData: (previousData) => previousData
  });
}

export function useKioskGrindingPlanningBoardLoad(category: GrindingPlanningBoardCategory) {
  return useQuery({
    queryKey: productionScheduleQueryKeys.grindingPlanningBoardLoad(category),
    queryFn: () => getKioskGrindingPlanningBoardLoad(category),
    refetchOnWindowFocus: false,
    staleTime: LEADER_BOARD_LEADER_PHASED_STALE_MS
  });
}

type PlanningBoardRefetchOptions = NonNullable<Parameters<ReturnType<typeof useKioskGrindingPlanningBoard>['refetch']>[0]> & {
  loadAlreadyInvalidated?: boolean;
};

export type KioskGrindingPlanningBoardProgressiveResult = {
  data: GrindingPlanningBoardResponse | undefined;
  isLoading: boolean;
  isFetching: boolean;
  isError: boolean;
  error: unknown;
  isPlaceholderData: boolean;
  refetch: (options?: PlanningBoardRefetchOptions) => Promise<{
    data: GrindingPlanningBoardResponse | undefined; isError: boolean; error: unknown;
  }>;
  hasStableData: boolean;
  scopeReady: boolean;
  isAppending: boolean;
  isComplete: boolean;
  appendError: unknown;
};

/**
 * 初回ページを先に表示し、同じスナップショットの残りだけを順次追補する。
 * 同じ条件の全件表示後は、次の全件がそろうまで表示中のスナップショットを保持する。
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
  const queryClient = useQueryClient();
  const previousRevisionRef = useRef<{ paramsKey: string; revision: string } | undefined>(undefined);
  const loadAlreadyInvalidatedRef = useRef<string | null>(null);
  const paramsKey = useMemo(() => JSON.stringify(params ?? null), [params]);
  const mergedParamsKeyRef = useRef<string | null>(null);
  const [mergedData, setMergedData] = useState<GrindingPlanningBoardResponse>();
  const displayedRef = useRef<{ paramsKey: string; data: GrindingPlanningBoardResponse; complete: boolean } | undefined>(undefined);
  const completeDataRef = useRef(new Map<string, { signature: string; data: GrindingPlanningBoardResponse }>());
  type Settlement = { paramsKey: string; updatedAt: number; data: GrindingPlanningBoardResponse | undefined; isError: boolean; error: unknown };
  const settledRef = useRef<Settlement | undefined>(undefined);
  const [settlement, setSettlement] = useState<Settlement>();
  const currentScopeRef = useRef<string | null>(paramsKey);
  currentScopeRef.current = paramsKey;
  const waitersRef = useRef(new Set<(settlement: Settlement) => void>());
  useEffect(() => {
    if (!settlement) return;
    settledRef.current = settlement;
    for (const waiter of waitersRef.current) waiter(settlement);
  }, [settlement]);
  const [isAppending, setIsAppending] = useState(false);
  const [isComplete, setIsComplete] = useState(false);
  const [appendError, setAppendError] = useState<unknown>(null);
  const runIdRef = useRef(0);
  const syncedSignatureRef = useRef<string | null>(null);
  const staleRefetchCountRef = useRef(0);
  const stableParams = useMemo(
    () => paramsKey === 'null' ? undefined : JSON.parse(paramsKey) as KioskGrindingPlanningBoardQuery,
    [paramsKey]
  );

  useEffect(() => {
    runIdRef.current += 1;
    syncedSignatureRef.current = null;
    staleRefetchCountRef.current = 0;
    setIsAppending(false);
    setIsComplete(false);
    setAppendError(null);
  }, [paramsKey]);

  const firstData = query.data;
  const refetch = query.refetch;
  // Refresh consumers must not clear confirmed writes before the replacement is complete.
  const refetchComplete = useCallback(async (options?: PlanningBoardRefetchOptions) => {
    const { loadAlreadyInvalidated, ...queryOptions } = options ?? {};
    // Piece mutations refresh load independently, including when this board request fails.
    if (loadAlreadyInvalidated) loadAlreadyInvalidatedRef.current = paramsKey;
    try {
      const previousSettlement = settledRef.current;
      const result = await refetch(queryOptions);
      if (result.isError) return result;
      if (currentScopeRef.current !== paramsKey) return { data: undefined, isError: true, error: new Error('一覧の取得が中断されました。') };
      return await new Promise<Settlement>((resolve) => {
        const waiter = (settlement: Settlement) => {
          if (settlement !== previousSettlement && (settlement.paramsKey !== paramsKey || settlement.updatedAt >= result.dataUpdatedAt)) {
            waitersRef.current.delete(waiter);
            resolve(settlement);
          }
        };
        waitersRef.current.add(waiter);
        if (settledRef.current) waiter(settledRef.current);
      });
    } finally {
      if (loadAlreadyInvalidated && loadAlreadyInvalidatedRef.current === paramsKey) loadAlreadyInvalidatedRef.current = null;
    }
  }, [paramsKey, refetch]);
  useEffect(() => {
    currentScopeRef.current = paramsKey;
    const waiters = waitersRef.current;
    return () => {
      currentScopeRef.current = null;
      for (const waiter of waiters) waiter({ paramsKey: '', updatedAt: Infinity, data: undefined, isError: true, error: new Error('一覧の取得が中断されました。') });
    };
  }, [paramsKey]);
  useEffect(() => {
    if (query.isError && !query.isFetching) {
      setSettlement({ paramsKey, updatedAt: Infinity, data: displayedRef.current?.data, isError: true, error: query.error });
    }
  }, [paramsKey, query.isError, query.isFetching, query.error]);
  const firstDataIsFresh = Boolean(firstData && !query.isPlaceholderData);
  const firstSignature = firstData
    ? `${query.dataUpdatedAt}:${firstData.snapshotId}:${firstData.sourceRevision}`
    : null;

  useEffect(() => {
    if (!firstDataIsFresh || !firstData || query.isFetching || query.isError) return;
    const previous = previousRevisionRef.current;
    previousRevisionRef.current = { paramsKey, revision: firstData.sourceRevision };
    if (previous?.paramsKey === paramsKey && previous.revision !== firstData.sourceRevision && loadAlreadyInvalidatedRef.current !== paramsKey) {
      void queryClient.invalidateQueries(
        { queryKey: productionScheduleQueryKeys.grindingPlanningBoardLoadAll },
        { cancelRefetch: false }
      );
    }
  }, [firstData, firstDataIsFresh, paramsKey, query.isFetching, query.isError, queryClient]);

  useEffect(() => {
    if (!firstDataIsFresh || !firstData || firstSignature == null || query.isFetching || query.isError) return;
    if (syncedSignatureRef.current === firstSignature) return;
    syncedSignatureRef.current = firstSignature;
    const runId = ++runIdRef.current;
    let cancelled = false;
    const initial = firstData;
    let items = [...initial.items];
    let cursor = initial.nextCursor;
    let previousCursor = -1;

    const keepComplete = displayedRef.current?.paramsKey === paramsKey && displayedRef.current.complete;
    const publish = (data = { ...initial, items, nextCursor: cursor }) => {
      const complete = data.nextCursor == null;
      mergedParamsKeyRef.current = paramsKey;
      displayedRef.current = { paramsKey, data, complete };
      setMergedData(data);
      setIsComplete(complete);
      if (complete) {
        const cache = completeDataRef.current;
        cache.delete(paramsKey);
        cache.set(paramsKey, { signature: firstSignature, data });
        if (cache.size > 6) cache.delete(cache.keys().next().value!);
        setSettlement({ paramsKey, updatedAt: query.dataUpdatedAt, data, isError: false, error: null });
      }
    };
    const cached = completeDataRef.current.get(paramsKey);
    if (cached?.signature === firstSignature) {
      publish(cached.data);
      setAppendError(null);
      staleRefetchCountRef.current = 0;
      setIsAppending(false);
      return;
    }
    if (!keepComplete || cursor == null) publish();
    setAppendError(null);
    if (cursor == null) {
      staleRefetchCountRef.current = 0;
      setIsAppending(false);
      return;
    }

    setIsAppending(!keepComplete);
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
            pageSize: 640,
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
          if (!keepComplete || cursor == null) publish();
          if (cursor == null) staleRefetchCountRef.current = 0;
        }
      } catch (error) {
        if (!cancelled && runId === runIdRef.current) {
          if (
            isAxiosError(error) && error.response?.status === 409 &&
            error.response.data?.errorCode === 'STALE_PLANNING_BOARD_SNAPSHOT' &&
            staleRefetchCountRef.current < 2
          ) {
            staleRefetchCountRef.current += 1;
            void refetch();
            return;
          }
          const failure = normalizeLeaderboardContinueFailure(error);
          setAppendError(failure);
          if (!keepComplete) setIsComplete(false);
          setSettlement({ paramsKey, updatedAt: query.dataUpdatedAt, data: displayedRef.current?.data, isError: true, error: failure });
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
  }, [firstData, firstDataIsFresh, firstSignature, query.isFetching, query.isError, refetch, stableParams, paramsKey, query.dataUpdatedAt]);

  const displayData = mergedData ?? firstData;
  const hasStableData = Boolean(
    firstData && !query.isPlaceholderData && mergedParamsKeyRef.current === paramsKey &&
    (mergedData?.snapshotId === firstData.snapshotId || displayedRef.current?.complete)
  );
  // A same-scope revalidation keeps the current snapshot usable. Placeholder
  // data and the first fetch remain unready through hasStableData above.
  const scopeReady = hasStableData;
  return {
    data: displayData,
    isLoading: query.isLoading,
    isFetching: query.isFetching,
    isError: query.isError,
    error: query.error,
    isPlaceholderData: query.isPlaceholderData,
    refetch: refetchComplete,
    hasStableData,
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
    queryKey: productionScheduleQueryKeys.grindingPlanningBoardSnapshot(params),
    queryFn: () => getKioskGrindingPlanningBoardSnapshot(params!),
    enabled: (options?.enabled ?? true) && Boolean(params),
    refetchInterval: options?.refetchIntervalMs ?? 30000,
    refetchOnWindowFocus: options?.refetchOnWindowFocus ?? true
  });
}

export function useKioskGrindingPlanningBoardSeibanCandidates(
  params: { category: GrindingPlanningBoardCategory; completionFilter: 'all' | 'incomplete' } | undefined,
  options?: { enabled?: boolean }
) {
  return useQuery({
    queryKey: productionScheduleQueryKeys.grindingPlanningBoardSeibanCandidates(params),
    queryFn: () => getKioskGrindingPlanningBoardSeibanCandidates(params!),
    enabled: (options?.enabled ?? true) && Boolean(params),
    placeholderData: (previousData, previousQuery) => {
      const previousParams = previousQuery?.queryKey?.[2] as typeof params;
      return previousParams?.category === params?.category ? previousData : undefined;
    },
    refetchInterval: 30000,
    refetchOnWindowFocus: false
  });
}

export function useUpdateKioskGrindingPlanningBoardOverrides(options?: { invalidateOnSuccess?: boolean }) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (payload: GrindingPlanningBoardOverridesRequest) => updateKioskGrindingPlanningBoardOverrides(payload),
    onSuccess: () => {
      if (options?.invalidateOnSuccess === false) return;
      void queryClient.invalidateQueries({ queryKey: productionScheduleQueryKeys.grindingPlanningBoardAll });
    }
  });
}

export function useUpdateKioskGrindingPlanningBoardPins(options?: { invalidateOnSuccess?: boolean }) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (payload: GrindingPlanningBoardPinsRequest) => updateKioskGrindingPlanningBoardPins(payload),
    onSuccess: () => {
      if (options?.invalidateOnSuccess === false) return;
      void queryClient.invalidateQueries({ queryKey: productionScheduleQueryKeys.grindingPlanningBoardAll });
    }
  });
}

export function useUpdateKioskGrindingPlanningBoardRank(options?: { invalidateOnSuccess?: boolean }) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (payload: GrindingPlanningBoardRankRequest) => updateKioskGrindingPlanningBoardRank(payload),
    onSuccess: (_result: GrindingPlanningBoardRankResponse) => {
      if (options?.invalidateOnSuccess === false) return;
      void queryClient.invalidateQueries({ queryKey: productionScheduleQueryKeys.grindingPlanningBoardAll });
    }
  });
}

export function useUpdateKioskGrindingPlanningBoardResourceOrder(options?: { invalidateOnSuccess?: boolean }) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (payload: GrindingPlanningBoardResourceOrderRequest) => updateKioskGrindingPlanningBoardResourceOrder(payload),
    onSuccess: (_result: GrindingPlanningBoardResourceOrderResponse) => {
      if (options?.invalidateOnSuccess === false) return;
      void queryClient.invalidateQueries({ queryKey: productionScheduleQueryKeys.grindingPlanningBoardAll });
    }
  });
}

export function useUpdateKioskGrindingPlanningBoardResourceOrderBulk(options?: { invalidateOnSuccess?: boolean }) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (payload: GrindingPlanningBoardResourceOrderBulkRequest) => updateKioskGrindingPlanningBoardResourceOrderBulk(payload),
    onSuccess: (_result: GrindingPlanningBoardResourceOrderResponse) => {
      if (options?.invalidateOnSuccess === false) return;
      void queryClient.invalidateQueries({ queryKey: productionScheduleQueryKeys.grindingPlanningBoardAll });
    }
  });
}

export function useUpdateKioskGrindingPlanningBoardSeibanOrder(options?: { invalidateOnSuccess?: boolean }) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (payload: GrindingPlanningBoardSeibanOrderRequest) => updateKioskGrindingPlanningBoardSeibanOrder(payload),
    onSuccess: () => {
      if (options?.invalidateOnSuccess === false) return;
      void queryClient.invalidateQueries({ queryKey: productionScheduleQueryKeys.grindingPlanningBoardAll });
    }
  });
}

export function useUpdateKioskGrindingPlanningBoardSeibanChecks(options?: { invalidateOnSuccess?: boolean }) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (payload: GrindingPlanningBoardSeibanChecksRequest) => updateKioskGrindingPlanningBoardSeibanChecks(payload),
    onSuccess: () => {
      if (options?.invalidateOnSuccess === false) return;
      void queryClient.invalidateQueries({ queryKey: productionScheduleQueryKeys.grindingPlanningBoardAll });
    }
  });
}

export function useKioskGrindingPlanningBoardDueDetail(fseiban: string | null) {
  return useQuery({
    queryKey: productionScheduleQueryKeys.grindingPlanningBoardDueDetail(fseiban),
    queryFn: () => getKioskGrindingPlanningBoardDueDetail(fseiban ?? ''),
    enabled: typeof fseiban === 'string' && fseiban.trim().length > 0,
    refetchOnWindowFocus: false
  });
}

export function useUpdateKioskGrindingPlanningBoardDueScope(options?: { invalidateOnSuccess?: boolean }) {
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
      if (options?.invalidateOnSuccess === false) return;
      void queryClient.invalidateQueries({ queryKey: productionScheduleQueryKeys.grindingPlanningBoardDueDetail(variables.fseiban) });
      void queryClient.invalidateQueries({ queryKey: productionScheduleQueryKeys.grindingPlanningBoardAll });
    }
  });
}

// Independent of board invalidation and progressive snapshots.
const planningBoardCapacityKey = productionScheduleQueryKeys.planningBoardResourceCapacityAll;

export function useKioskGrindingPlanningBoardResourceCapacity(enabled: boolean) {
  return useQuery({
    queryKey: planningBoardCapacityKey,
    queryFn: getKioskGrindingPlanningBoardResourceCapacity,
    enabled,
    staleTime: 10 * 60_000
  });
}

export function useUpdateKioskGrindingPlanningBoardResourceCapacity() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (payload: GrindingPlanningBoardResourceCapacityRequest) => updateKioskGrindingPlanningBoardResourceCapacity(payload),
    onMutate: async ({ resourceCd, dailyHours, runsThroughBreaks }) => {
      await queryClient.cancelQueries({ queryKey: planningBoardCapacityKey });
      const previous = queryClient.getQueryData<GrindingPlanningBoardResourceCapacityResponse>(planningBoardCapacityKey);
      queryClient.setQueryData<GrindingPlanningBoardResourceCapacityResponse>(planningBoardCapacityKey, {
        dailyHoursByResource: { ...previous?.dailyHoursByResource, ...(dailyHours !== undefined ? { [resourceCd]: dailyHours } : {}) },
        runsThroughBreaksResources: runsThroughBreaks === undefined ? previous?.runsThroughBreaksResources ?? []
          : [...(previous?.runsThroughBreaksResources ?? []).filter((resource) => resource !== resourceCd), ...(runsThroughBreaks ? [resourceCd] : [])]
      });
      return { previous };
    },
    onError: (_error, _variables, context) => {
      queryClient.setQueryData(planningBoardCapacityKey, context?.previous ?? { dailyHoursByResource: {}, runsThroughBreaksResources: [] });
    },
    onSuccess: (response) => queryClient.setQueryData(planningBoardCapacityKey, response)
  });
}

export function useUpdateKioskGrindingPlanningBoardArrival() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (payload: GrindingPlanningBoardArrivalRequest & { recorded: boolean }) => updateKioskGrindingPlanningBoardArrival(payload),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: productionScheduleQueryKeys.grindingPlanningBoardAll });
    }
  });
}

export function useKioskSessakuPieceMutations() {
  const queryClient = useQueryClient();
  const onSuccess = () => {
    void Promise.all([
      // The caller refreshes the full progressive board once; refresh its secondary consumers here.
      queryClient.invalidateQueries({ queryKey: productionScheduleQueryKeys.grindingPlanningBoardAll, refetchType: 'none' }),
      queryClient.invalidateQueries({ queryKey: productionScheduleQueryKeys.grindingPlanningBoardAll,
        predicate: (query) => typeof query.queryKey[1] === 'string' }),
      queryClient.invalidateQueries({ queryKey: productionScheduleQueryKeys.scheduleAll }),
      queryClient.invalidateQueries({ queryKey: productionScheduleQueryKeys.orderUsageAll }),
      queryClient.invalidateQueries({ queryKey: productionScheduleQueryKeys.historyProgressAll }),
      queryClient.invalidateQueries({ queryKey: productionScheduleQueryKeys.grindingPlanningBoardDueDetail(null).slice(0, 1) })
    ]);
  };
  const split = useMutation({ mutationFn: (payload: SessakuPiecesSplitRequest) => splitKioskSessakuPieces(payload), retry: false, onSuccess });
  const merge = useMutation({ mutationFn: (payload: SessakuPiecesMergeRequest) => mergeKioskSessakuPieces(payload), retry: false, onSuccess });
  const completion = useMutation({ mutationFn: ({ pieceId, ...payload }: SessakuPieceCompletionRequest & { pieceId: string }) =>
    setKioskSessakuPieceCompletion(pieceId, payload), retry: false, onSuccess });
  return { split, merge, completion };
}

export function useUpdateKioskGrindingPlanningBoardFirstProcessArrival() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (payload: GrindingPlanningBoardFirstProcessArrivalRequest) => updateKioskGrindingPlanningBoardFirstProcessArrival(payload),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: productionScheduleQueryKeys.grindingPlanningBoardAll });
    }
  });
}
