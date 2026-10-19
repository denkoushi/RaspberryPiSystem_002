import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import {
  addSelfInspectionReductionApprover,
  getSelfInspectionReductionInsights,
  getSelfInspectionReductionSettings,
  recordSelfInspectionChangePoint,
  recordSelfInspectionLevelDecision,
  removeSelfInspectionReductionApprover,
  updateSelfInspectionReductionPolicy,
  type SelfInspectionReductionPeriodDays,
  type SelfInspectionReductionSettings
} from '../client';
import { selfInspectionQueryKeys } from '../queryKeys/selfInspection';

export function useSelfInspectionReductionInsights(periodDays: SelfInspectionReductionPeriodDays) {
  return useQuery({
    queryKey: selfInspectionQueryKeys.reductionInsights(periodDays),
    queryFn: () => getSelfInspectionReductionInsights(periodDays),
    refetchInterval: 60000,
    refetchOnWindowFocus: false
  });
}

export function useSelfInspectionReductionSettings() {
  return useQuery({
    queryKey: selfInspectionQueryKeys.reductionSettingsAll,
    queryFn: () => getSelfInspectionReductionSettings(),
    refetchOnWindowFocus: false
  });
}

export function useUpdateSelfInspectionReductionPolicy() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: updateSelfInspectionReductionPolicy,
    onSuccess: (settings) => {
      queryClient.setQueryData(selfInspectionQueryKeys.reductionSettingsAll, settings);
    }
  });
}

function useApproverMutation<TPayload>(
  mutationFn: (payload: TPayload) => Promise<SelfInspectionReductionSettings['approvers']>
) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn,
    onSuccess: (approvers) => {
      queryClient.setQueryData<SelfInspectionReductionSettings>(selfInspectionQueryKeys.reductionSettingsAll, (current) =>
        current ? { ...current, approvers } : current
      );
      void queryClient.invalidateQueries({ queryKey: selfInspectionQueryKeys.reductionSettingsAll });
    }
  });
}

export function useAddSelfInspectionReductionApprover() {
  return useApproverMutation(addSelfInspectionReductionApprover);
}

export function useRemoveSelfInspectionReductionApprover() {
  return useApproverMutation(removeSelfInspectionReductionApprover);
}

export function useRecordSelfInspectionChangePoint() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: recordSelfInspectionChangePoint,
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: selfInspectionQueryKeys.reductionInsightsAll })
  });
}

export function useRecordSelfInspectionLevelDecision() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: recordSelfInspectionLevelDecision,
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: selfInspectionQueryKeys.reductionInsightsAll })
  });
}
