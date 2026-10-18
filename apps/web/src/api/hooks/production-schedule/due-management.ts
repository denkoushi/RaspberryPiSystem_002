import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import {
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
  getKioskProductionScheduleProgressOverview,
  updateKioskProductionScheduleDueManagementSeibanDueDate,
  updateKioskProductionScheduleDueManagementSeibanProcessingDueDate,
  updateKioskProductionScheduleDueManagementPartPriorities,
  updateKioskProductionScheduleDueManagementPartProcessingType,
  updateKioskProductionScheduleDueManagementPartNote,
  updateKioskProductionScheduleDueManagementTriageSelection,
  updateKioskProductionScheduleDueManagementDailyPlan,
  updateKioskProductionScheduleDueManagementGlobalRank,
  verifyKioskDueManagementAccessPassword
} from '../../client';
import { productionScheduleQueryKeys } from '../../queryKeys/productionSchedule';

type DueManagementFilterContext = {
  resourceCd?: string;
  resourceCategory?: 'grinding' | 'cutting';
};

export function useKioskProductionScheduleDueManagementSummary(context?: DueManagementFilterContext) {
  return useQuery({
    queryKey: productionScheduleQueryKeys.dueManagementSummary(context),
    queryFn: () => getKioskProductionScheduleDueManagementSummary(context),
    refetchInterval: 30000
  });
}

export function useKioskProductionScheduleDueManagementTriage(context?: DueManagementFilterContext) {
  return useQuery({
    queryKey: productionScheduleQueryKeys.dueManagementTriage(context),
    queryFn: () => getKioskProductionScheduleDueManagementTriage(context),
    refetchInterval: 30000
  });
}

export function useKioskProductionScheduleDueManagementDailyPlan(context?: DueManagementFilterContext) {
  return useQuery({
    queryKey: productionScheduleQueryKeys.dueManagementDailyPlan(context),
    queryFn: () => getKioskProductionScheduleDueManagementDailyPlan(context),
    refetchInterval: 30000
  });
}

export function useKioskProductionScheduleDueManagementSeibanDetail(
  fseiban: string | null,
  context?: DueManagementFilterContext
) {
  return useQuery({
    queryKey: productionScheduleQueryKeys.dueManagementSeiban(fseiban, context),
    queryFn: () => getKioskProductionScheduleDueManagementSeibanDetail(fseiban ?? '', context),
    enabled: typeof fseiban === 'string' && fseiban.trim().length > 0
  });
}

export function useKioskProductionScheduleProgressOverview() {
  return useQuery({
    queryKey: productionScheduleQueryKeys.progressOverviewAll,
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
      void queryClient.invalidateQueries({ queryKey: productionScheduleQueryKeys.dueManagementSummaryAll });
      void queryClient.invalidateQueries({
        queryKey: productionScheduleQueryKeys.dueManagementSeibanAll(variables.fseiban)
      });
      void queryClient.invalidateQueries({ queryKey: productionScheduleQueryKeys.scheduleAll });
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
      void queryClient.invalidateQueries({ queryKey: productionScheduleQueryKeys.dueManagementSummaryAll });
      void queryClient.invalidateQueries({
        queryKey: productionScheduleQueryKeys.dueManagementSeibanAll(variables.fseiban)
      });
      void queryClient.invalidateQueries({ queryKey: productionScheduleQueryKeys.scheduleAll });
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
        queryKey: productionScheduleQueryKeys.dueManagementSeibanAll(variables.fseiban)
      });
      void queryClient.invalidateQueries({ queryKey: productionScheduleQueryKeys.dueManagementSummaryAll });
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
        queryKey: productionScheduleQueryKeys.dueManagementSeibanAll(variables.fseiban)
      });
      void queryClient.invalidateQueries({ queryKey: productionScheduleQueryKeys.scheduleAll });
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
        queryKey: productionScheduleQueryKeys.dueManagementSeibanAll(variables.fseiban)
      });
      void queryClient.invalidateQueries({ queryKey: productionScheduleQueryKeys.scheduleAll });
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
        queryKey: productionScheduleQueryKeys.dueManagementTriageAll
      });
      void queryClient.invalidateQueries({
        queryKey: productionScheduleQueryKeys.dueManagementDailyPlanAll
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
        queryKey: productionScheduleQueryKeys.dueManagementDailyPlanAll
      });
      void queryClient.invalidateQueries({
        queryKey: productionScheduleQueryKeys.dueManagementTriageAll
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
    queryKey: productionScheduleQueryKeys.dueManagementGlobalRank(context),
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
    queryKey: productionScheduleQueryKeys.dueManagementManualOrderOverview(context),
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
    queryKey: productionScheduleQueryKeys.manualOrderSiteDevices(siteKey),
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
    queryKey: productionScheduleQueryKeys.manualOrderResourceAssignments(siteKey),
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
        queryKey: productionScheduleQueryKeys.manualOrderResourceAssignments(variables.siteKey)
      });
      void queryClient.invalidateQueries({ queryKey: productionScheduleQueryKeys.dueManagementManualOrderOverviewAll });
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
        queryKey: productionScheduleQueryKeys.dueManagementGlobalRankAll
      });
      void queryClient.invalidateQueries({
        queryKey: productionScheduleQueryKeys.dueManagementDailyPlanAll
      });
    }
  });
}

export function useKioskProductionScheduleDueManagementGlobalRankProposal(context?: DueManagementTargetContext) {
  return useQuery({
    queryKey: productionScheduleQueryKeys.dueManagementGlobalRankProposal(context),
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
        queryKey: productionScheduleQueryKeys.dueManagementGlobalRankAll
      });
      void queryClient.invalidateQueries({
        queryKey: productionScheduleQueryKeys.dueManagementGlobalRankProposalAll
      });
      void queryClient.invalidateQueries({
        queryKey: productionScheduleQueryKeys.dueManagementDailyPlanAll
      });
    }
  });
}

export function useVerifyKioskDueManagementAccessPassword() {
  return useMutation({
    mutationFn: (payload: { password: string }) => verifyKioskDueManagementAccessPassword(payload)
  });
}
