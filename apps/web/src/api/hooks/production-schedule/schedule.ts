import {
  useMutation,
  useQuery,
  useQueryClient,
  type QueryKey
} from '@tanstack/react-query';
import { useMemo } from 'react';

import { findProcessingOrderForRow, patchOrderUsageForProcessingOrderChange, patchScheduleListProcessingOrder } from '../../../features/kiosk/productionSchedule/cache/kioskProductionScheduleOrderCachePatch';
import {
  setKioskProductionScheduleRowCompletion,
  getKioskProductionSchedule,
  getKioskProductionScheduleOrderSearchCandidates,
  getKioskProductionScheduleOrderUsage,
  getKioskProductionScheduleResources,
  getKioskProductionScheduleProcessingTypeOptions,
  getKioskProductionScheduleSearchState,
  getKioskProductionScheduleSearchHistory,
  getKioskProductionScheduleHistoryProgress,
  postKioskProductionScheduleSeibanMachineNames,
  setKioskProductionScheduleSearchState,
  setKioskProductionScheduleSearchHistory,
  updateKioskProductionScheduleOrder,
  updateKioskProductionScheduleNote,
  updateKioskProductionScheduleDueDate,
  updateKioskProductionScheduleSplitDueDate,
  updateKioskProductionScheduleSplitOrder,
  updateKioskProductionScheduleProcessing
} from '../../client';
import { productionScheduleQueryKeys } from '../../queryKeys/productionSchedule';

import type { KioskProductionScheduleListCache } from '../../../features/kiosk/productionSchedule/cache/kioskProductionScheduleListCache';

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
    queryKey: productionScheduleQueryKeys.schedule(params),
    queryFn: () => getKioskProductionSchedule(params),
    // 仕掛中が頻繁に変わるため軽く自動更新
    // NOTE: 書き込み操作（完了/未完了戻し/納期/備考/順番/処理など）と同時に走ると体感遅延が出やすいので、
    //       操作中はポーリングを止め、操作完了後に invalidate で再取得させる。
    refetchInterval: interval,
    placeholderData: (previousData) => previousData,
    enabled: options?.enabled ?? true
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
    queryKey: productionScheduleQueryKeys.orderSearch(params),
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
    queryKey: productionScheduleQueryKeys.resourcesAll,
    queryFn: getKioskProductionScheduleResources,
    refetchInterval: interval
  });
}

export function useKioskProductionScheduleProcessingTypeOptions(options?: { pauseRefetch?: boolean }) {
  return useQuery({
    queryKey: productionScheduleQueryKeys.kioskProcessingTypeOptionsAll,
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
    queryKey: productionScheduleQueryKeys.orderUsage(resourceCds, options?.targetDeviceScopeKey),
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
    queryKey: productionScheduleQueryKeys.searchStateAll,
    queryFn: getKioskProductionScheduleSearchState,
    refetchInterval: interval
  });
}

export function useKioskProductionScheduleSearchHistory(options?: { pauseRefetch?: boolean }) {
  return useQuery({
    queryKey: productionScheduleQueryKeys.searchHistoryAll,
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
    queryKey: productionScheduleQueryKeys.historyProgressAll,
    queryFn: getKioskProductionScheduleHistoryProgress,
    refetchInterval: interval,
    enabled: options?.enabled ?? true
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
    queryKey: productionScheduleQueryKeys.seibanMachineNames(keyFingerprint),
    queryFn: () => postKioskProductionScheduleSeibanMachineNames({ fseibans: sortedUnique }),
    enabled: (options?.enabled ?? true) && sortedUnique.length > 0,
    refetchInterval: options?.pauseRefetch ? false : 30000
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
      void queryClient.invalidateQueries({ queryKey: productionScheduleQueryKeys.searchHistoryAll });
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
  void queryClient.cancelQueries({ queryKey: productionScheduleQueryKeys.scheduleAll });
  void queryClient.cancelQueries({ queryKey: productionScheduleQueryKeys.orderUsageAll });

  const policy = variables.cachePolicy ?? 'default';
  if (policy !== 'leaderBoardFastPath' && policy !== 'manualOrderOptimistic') {
    return undefined;
  }

  const targetDeviceScopeKey = normalizeTargetDeviceScopeKey(variables.payload.targetDeviceScopeKey);
  const allScheduleSnapshots = queryClient.getQueriesData({
    queryKey: productionScheduleQueryKeys.scheduleAll
  });
  const allUsageSnapshots = queryClient.getQueriesData({
    queryKey: productionScheduleQueryKeys.orderUsageAll
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
      { queryKey: productionScheduleQueryKeys.scheduleAll },
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
        { queryKey: productionScheduleQueryKeys.orderUsageAll },
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
      { queryKey: productionScheduleQueryKeys.scheduleAll },
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
    queryKey: productionScheduleQueryKeys.scheduleAll
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
      void queryClient.invalidateQueries({ queryKey: productionScheduleQueryKeys.scheduleAll });
      void queryClient.invalidateQueries({ queryKey: productionScheduleQueryKeys.orderUsageAll });
      void queryClient.invalidateQueries({
        queryKey: productionScheduleQueryKeys.dueManagementManualOrderOverviewAll
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
      void queryClient.cancelQueries({ queryKey: productionScheduleQueryKeys.scheduleAll });
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
      }>({ queryKey: productionScheduleQueryKeys.scheduleAll }, (oldData) => {
        if (!oldData) return oldData;
        return {
          ...oldData,
          rows: oldData.rows.map((row) =>
            row.id === rowId ? { ...row, note: data.note } : row
          )
        };
      });
      void queryClient.invalidateQueries({ queryKey: productionScheduleQueryKeys.scheduleAll });
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
      void queryClient.cancelQueries({ queryKey: productionScheduleQueryKeys.scheduleAll });
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
      }>({ queryKey: productionScheduleQueryKeys.scheduleAll }, (oldData) => {
        if (!oldData) return oldData;
        return {
          ...oldData,
          rows: oldData.rows.map((row) =>
            row.id === rowId ? { ...row, dueDate: data.dueDate } : row
          )
        };
      });
      void queryClient.invalidateQueries({ queryKey: productionScheduleQueryKeys.scheduleAll });
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
      void queryClient.invalidateQueries({ queryKey: productionScheduleQueryKeys.scheduleAll });
      void queryClient.invalidateQueries({ queryKey: productionScheduleQueryKeys.orderUsageAll });
      if (policy === 'manualOrderOptimistic') {
        void queryClient.invalidateQueries({
          queryKey: productionScheduleQueryKeys.dueManagementManualOrderOverviewAll
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
      void queryClient.cancelQueries({ queryKey: productionScheduleQueryKeys.scheduleAll });
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: productionScheduleQueryKeys.scheduleAll });
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
      void queryClient.cancelQueries({ queryKey: productionScheduleQueryKeys.scheduleAll });
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
      }>({ queryKey: productionScheduleQueryKeys.scheduleAll }, (oldData) => {
        if (!oldData) return oldData;
        return {
          ...oldData,
          rows: oldData.rows.map((row) =>
            row.id === rowId ? { ...row, processingType: data.processingType } : row
          )
        };
      });
      void queryClient.invalidateQueries({ queryKey: productionScheduleQueryKeys.scheduleAll });
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
      void queryClient.cancelQueries({ queryKey: productionScheduleQueryKeys.scheduleAll });
      void queryClient.cancelQueries({ queryKey: productionScheduleQueryKeys.orderUsageAll });
    },
    onSuccess: (data, variables) => {
      const { rowId } = variables;
      // Optimistic Update: キャッシュを直接更新して即座にUIを更新
      queryClient.setQueriesData<KioskProductionScheduleListCache>(
        { queryKey: productionScheduleQueryKeys.scheduleAll },
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
      void queryClient.invalidateQueries({ queryKey: productionScheduleQueryKeys.scheduleAll });
      void queryClient.invalidateQueries({ queryKey: productionScheduleQueryKeys.orderUsageAll });
      void queryClient.invalidateQueries({ queryKey: productionScheduleQueryKeys.historyProgressAll });
      void queryClient.invalidateQueries({ queryKey: productionScheduleQueryKeys.progressOverviewAll });
      void queryClient.invalidateQueries({
        queryKey: productionScheduleQueryKeys.dueManagementManualOrderOverviewAll
      });
    }
  });
}
