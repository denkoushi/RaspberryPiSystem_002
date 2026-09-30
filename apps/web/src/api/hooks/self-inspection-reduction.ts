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

const INSIGHTS_KEY = ['self-inspection-reduction', 'insights'] as const;
const SETTINGS_KEY = ['self-inspection-reduction', 'settings'] as const;

export function useSelfInspectionReductionInsights(periodDays: SelfInspectionReductionPeriodDays) {
  return useQuery({
    queryKey: [...INSIGHTS_KEY, periodDays],
    queryFn: () => getSelfInspectionReductionInsights(periodDays),
    refetchInterval: 60000,
    refetchOnWindowFocus: false
  });
}

export function useSelfInspectionReductionSettings() {
  return useQuery({
    queryKey: SETTINGS_KEY,
    queryFn: () => getSelfInspectionReductionSettings(),
    refetchOnWindowFocus: false
  });
}

export function useUpdateSelfInspectionReductionPolicy() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: updateSelfInspectionReductionPolicy,
    onSuccess: (settings) => {
      queryClient.setQueryData(SETTINGS_KEY, settings);
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
      queryClient.setQueryData<SelfInspectionReductionSettings>(SETTINGS_KEY, (current) =>
        current ? { ...current, approvers } : current
      );
      void queryClient.invalidateQueries({ queryKey: SETTINGS_KEY });
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
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: INSIGHTS_KEY })
  });
}

export function useRecordSelfInspectionLevelDecision() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: recordSelfInspectionLevelDecision,
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: INSIGHTS_KEY })
  });
}
