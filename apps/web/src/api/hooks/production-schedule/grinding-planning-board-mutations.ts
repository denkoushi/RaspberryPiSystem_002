import { useMutation, useQueryClient } from '@tanstack/react-query';
import { isAxiosError } from 'axios';

import {
  splitKioskSessakuPieceOps,
  mergeKioskSessakuPieceOps,
  splitKioskSessakuPieces,
  mergeKioskSessakuPieces,
  setKioskSessakuPieceCompletion,
  setKioskSessakuPieceOpCompletion,
  updateKioskGrindingPlanningBoardResourceCapacity,
  updateKioskGrindingPlanningBoardArrival,
  updateKioskGrindingPlanningBoardFirstProcessArrival,
  updateKioskGrindingPlanningBoardOverrides,
  updateKioskGrindingPlanningBoardPins,
  updateKioskGrindingPlanningBoardRank,
  updateKioskGrindingPlanningBoardResourceOrder,
  updateKioskGrindingPlanningBoardResourceMove,
  updateKioskGrindingPlanningBoardResourceOrderBulk,
  updateKioskGrindingPlanningBoardSeibanOrder,
  updateKioskGrindingPlanningBoardSeibanChecks,
  updateKioskGrindingPlanningBoardDueScope
} from '../../client';
import { configureKioskSessakuPieceOps, clearKioskSessakuPieceOps } from '../../domains/production-schedule/grinding-planning-board';
import { productionScheduleQueryKeys } from '../../queryKeys/productionSchedule';

import type {
  SessakuPieceOpsConfigureRequest,
  SessakuPieceOpsClearRequest,
  SessakuPieceOpSplitRequest,
  SessakuPieceOpMergeRequest,
  SessakuPiecesSplitRequest,
  SessakuPiecesMergeRequest,
  SessakuPieceCompletionRequest,
  GrindingPlanningBoardFirstProcessArrivalRequest,
  GrindingPlanningBoardArrivalRequest,
  GrindingPlanningBoardResourceCapacityRequest,
  GrindingPlanningBoardResourceCapacityResponse,
  GrindingPlanningBoardOverridesRequest,
  GrindingPlanningBoardRankRequest,
  GrindingPlanningBoardRankResponse,
  GrindingPlanningBoardResourceOrderRequest,
  GrindingPlanningBoardResourceMoveRequest,
  GrindingPlanningBoardResourceOrderBulkRequest,
  GrindingPlanningBoardPinsRequest,
  GrindingPlanningBoardResourceOrderResponse,
  GrindingPlanningBoardSeibanOrderRequest,
  GrindingPlanningBoardSeibanChecksRequest,
  GrindingPlanningBoardDueScopeRequest
} from '@raspi-system/shared-types';

const planningBoardCapacityKey = productionScheduleQueryKeys.planningBoardResourceCapacityAll;

export function useUpdateKioskGrindingPlanningBoardOverrides(options?: { invalidateOnSuccess?: boolean; dueSource?: 'excel' | 'scaw' }) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (payload: GrindingPlanningBoardOverridesRequest) => updateKioskGrindingPlanningBoardOverrides({ ...payload, ...(options?.dueSource == null ? {} : { dueSource: options.dueSource }) }),
    onSuccess: () => {
      if (options?.invalidateOnSuccess === false) return;
      void queryClient.invalidateQueries({ queryKey: productionScheduleQueryKeys.grindingPlanningBoardAll });
    }
  });
}

export function useUpdateKioskGrindingPlanningBoardPins(options?: { invalidateOnSuccess?: boolean; dueSource?: 'excel' | 'scaw' }) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (payload: GrindingPlanningBoardPinsRequest) => updateKioskGrindingPlanningBoardPins({ ...payload, ...(options?.dueSource == null ? {} : { dueSource: options.dueSource }) }),
    onSuccess: () => {
      if (options?.invalidateOnSuccess === false) return;
      void queryClient.invalidateQueries({ queryKey: productionScheduleQueryKeys.grindingPlanningBoardAll });
    }
  });
}

export function useUpdateKioskGrindingPlanningBoardRank(options?: { invalidateOnSuccess?: boolean; dueSource?: 'excel' | 'scaw' }) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (payload: GrindingPlanningBoardRankRequest) => updateKioskGrindingPlanningBoardRank({ ...payload, ...(options?.dueSource == null ? {} : { dueSource: options.dueSource }) }),
    onSuccess: (_result: GrindingPlanningBoardRankResponse) => {
      if (options?.invalidateOnSuccess === false) return;
      void queryClient.invalidateQueries({ queryKey: productionScheduleQueryKeys.grindingPlanningBoardAll });
    }
  });
}

export function useUpdateKioskGrindingPlanningBoardResourceOrder(options?: { invalidateOnSuccess?: boolean; dueSource?: 'excel' | 'scaw' }) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (payload: GrindingPlanningBoardResourceOrderRequest) => updateKioskGrindingPlanningBoardResourceOrder({ ...payload, ...(options?.dueSource == null ? {} : { dueSource: options.dueSource }) }),
    onSuccess: (_result: GrindingPlanningBoardResourceOrderResponse) => {
      if (options?.invalidateOnSuccess === false) return;
      void queryClient.invalidateQueries({ queryKey: productionScheduleQueryKeys.grindingPlanningBoardAll });
    }
  });
}

export function useUpdateKioskGrindingPlanningBoardResourceMove(options?: { invalidateOnSuccess?: boolean; dueSource?: 'excel' | 'scaw' }) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (payload: GrindingPlanningBoardResourceMoveRequest) => updateKioskGrindingPlanningBoardResourceMove({ ...payload, ...(options?.dueSource == null ? {} : { dueSource: options.dueSource }) }),
    onSuccess: () => {
      if (options?.invalidateOnSuccess === false) return;
      void queryClient.invalidateQueries({ queryKey: productionScheduleQueryKeys.grindingPlanningBoardAll });
    }
  });
}

export function useUpdateKioskGrindingPlanningBoardResourceOrderBulk(options?: { invalidateOnSuccess?: boolean; dueSource?: 'excel' | 'scaw' }) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (payload: GrindingPlanningBoardResourceOrderBulkRequest) => updateKioskGrindingPlanningBoardResourceOrderBulk({ ...payload, ...(options?.dueSource == null ? {} : { dueSource: options.dueSource }) }),
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

export function useUpdateKioskGrindingPlanningBoardResourceCapacity(options?: { invalidateOnSuccess?: boolean }) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (payload: GrindingPlanningBoardResourceCapacityRequest) => updateKioskGrindingPlanningBoardResourceCapacity(payload),
    onMutate: async ({ resourceCd, dailyHours, runsThroughBreaks, unitSplitEnabled }) => {
      await queryClient.cancelQueries({ queryKey: planningBoardCapacityKey });
      const previous = queryClient.getQueryData<GrindingPlanningBoardResourceCapacityResponse>(planningBoardCapacityKey);
      const flags = { ...previous?.unitSplitEnabledByResource };
      if (unitSplitEnabled === null) delete flags[resourceCd];
      else if (typeof unitSplitEnabled === 'boolean') flags[resourceCd] = unitSplitEnabled;
      queryClient.setQueryData<GrindingPlanningBoardResourceCapacityResponse>(planningBoardCapacityKey, {
        ...previous,
        ...(unitSplitEnabled !== undefined ? { unitSplitEnabledByResource: flags } : {}),
        dailyHoursByResource: { ...previous?.dailyHoursByResource, ...(dailyHours !== undefined ? { [resourceCd]: dailyHours } : {}) },
        runsThroughBreaksResources: runsThroughBreaks === undefined ? previous?.runsThroughBreaksResources ?? []
          : [...(previous?.runsThroughBreaksResources ?? []).filter((resource) => resource !== resourceCd), ...(runsThroughBreaks ? [resourceCd] : [])]
      });
      return { previous };
    },
    onError: (_error, _variables, context) => {
      queryClient.setQueryData(planningBoardCapacityKey, context?.previous ?? { dailyHoursByResource: {}, runsThroughBreaksResources: [] });
    },
    onSuccess: (response, variables) => {
      // A periodic fetch that started before this save would overwrite the saved value with an older one.
      const refetching = queryClient.isFetching({ queryKey: planningBoardCapacityKey }) > 0;
      queryClient.setQueryData(planningBoardCapacityKey, response);
      if (refetching) void queryClient.invalidateQueries({ queryKey: planningBoardCapacityKey });
      if (variables.unitSplitEnabled !== undefined && options?.invalidateOnSuccess !== false) {
        // This prefix includes both board and load queries.
        void queryClient.invalidateQueries({ queryKey: productionScheduleQueryKeys.grindingPlanningBoardAll });
      }
    }
  });
}

export function useUpdateKioskGrindingPlanningBoardArrival(dueSource?: 'excel' | 'scaw') {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (payload: GrindingPlanningBoardArrivalRequest & { recorded: boolean }) => updateKioskGrindingPlanningBoardArrival({ ...payload, ...(dueSource == null ? {} : { dueSource }) }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: productionScheduleQueryKeys.grindingPlanningBoardAll });
    }
  });
}

export function useKioskSessakuPieceMutations(dueSource?: 'excel' | 'scaw') {
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
  const split = useMutation({ mutationFn: (payload: SessakuPiecesSplitRequest) => splitKioskSessakuPieces({ ...payload, ...(dueSource == null ? {} : { dueSource }) }), retry: false, onSuccess });
  const merge = useMutation({ mutationFn: (payload: SessakuPiecesMergeRequest) => mergeKioskSessakuPieces({ ...payload, ...(dueSource == null ? {} : { dueSource }) }), retry: false, onSuccess });
  const completion = useMutation({ mutationFn: ({ pieceId, ...payload }: SessakuPieceCompletionRequest & { pieceId: string }) =>
    setKioskSessakuPieceCompletion(pieceId, { ...payload, ...(dueSource == null ? {} : { dueSource }) }), retry: false, onSuccess });
  const opCompletion = useMutation({ mutationFn: ({ pieceId, opNo, ...payload }: SessakuPieceCompletionRequest & { pieceId: string; opNo: number }) =>
    setKioskSessakuPieceOpCompletion(pieceId, opNo, { ...payload, ...(dueSource == null ? {} : { dueSource }) }), retry: false, onSuccess });
  const opSplit = useMutation({ mutationFn: (payload: SessakuPieceOpSplitRequest) => splitKioskSessakuPieceOps({ ...payload, ...(dueSource == null ? {} : { dueSource }) }), retry: false, onSuccess });
  const opMerge = useMutation({ mutationFn: (payload: SessakuPieceOpMergeRequest) => mergeKioskSessakuPieceOps({ ...payload, ...(dueSource == null ? {} : { dueSource }) }), retry: false, onSuccess });
  return { split, merge, completion, opCompletion, opSplit, opMerge };
}

export function useUpdateKioskGrindingPlanningBoardFirstProcessArrival(dueSource?: 'excel' | 'scaw') {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (payload: GrindingPlanningBoardFirstProcessArrivalRequest) => updateKioskGrindingPlanningBoardFirstProcessArrival({ ...payload, ...(dueSource == null ? {} : { dueSource }) }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: productionScheduleQueryKeys.grindingPlanningBoardAll });
    }
  });
}

export function useConfigureKioskSessakuPieceOps(dueSource?: 'excel' | 'scaw', options?: { refreshBoard: () => Promise<unknown> }) {
  const client = useQueryClient();
  return useMutation({ retry: false,
    mutationFn: (payload: SessakuPieceOpsConfigureRequest | SessakuPieceOpsClearRequest) => 'minutes' in payload
      ? configureKioskSessakuPieceOps({ ...payload, dueSource }) : clearKioskSessakuPieceOps({ ...payload, dueSource }),
    // Capture the current board scope before a category change or unmount.
    onMutate: (payload) => ({ refreshBoard: 'minutes' in payload ? options?.refreshBoard : undefined }),
    // A stale board must refresh after a conflict, like the other piece operations.
    onError: (error) => {
      if (isAxiosError(error) && error.response?.status === 409) void Promise.all([
        client.invalidateQueries({ queryKey: productionScheduleQueryKeys.grindingPlanningBoardAll }),
        client.invalidateQueries({ queryKey: productionScheduleQueryKeys.planningBoardResourceMinutesAll })
      ]);
    },
    onSuccess: async (_response, _payload, context) => {
      if (context.refreshBoard) {
        // Refresh the complete progressive board once, with revision-driven load refresh suppressed.
        await client.invalidateQueries({ queryKey: productionScheduleQueryKeys.grindingPlanningBoardAll, refetchType: 'none' });
        try { await context.refreshBoard(); } finally {
          // Mutation callbacks survive unmount; secondary consumers must not delay the dialog.
          void Promise.all([
            client.invalidateQueries({ queryKey: productionScheduleQueryKeys.grindingPlanningBoardAll,
              predicate: (query) => typeof query.queryKey[1] === 'string' }),
            client.invalidateQueries({ queryKey: productionScheduleQueryKeys.planningBoardResourceMinutesAll }),
            client.invalidateQueries({ queryKey: productionScheduleQueryKeys.scheduleAll }),
            client.invalidateQueries({ queryKey: productionScheduleQueryKeys.orderUsageAll }),
            client.invalidateQueries({ queryKey: productionScheduleQueryKeys.historyProgressAll }),
            client.invalidateQueries({ queryKey: productionScheduleQueryKeys.grindingPlanningBoardDueDetail(null).slice(0, 1) })
          ]);
        }
        return;
      }
      await Promise.all([
        client.invalidateQueries({ queryKey: productionScheduleQueryKeys.grindingPlanningBoardAll }),
        client.invalidateQueries({ queryKey: productionScheduleQueryKeys.planningBoardResourceMinutesAll }),
        client.invalidateQueries({ queryKey: productionScheduleQueryKeys.scheduleAll }),
        client.invalidateQueries({ queryKey: productionScheduleQueryKeys.orderUsageAll }),
        client.invalidateQueries({ queryKey: productionScheduleQueryKeys.historyProgressAll })
      ]);
    }
  });
}
