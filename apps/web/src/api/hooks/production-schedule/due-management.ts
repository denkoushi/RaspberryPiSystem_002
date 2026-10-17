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

export function useVerifyKioskDueManagementAccessPassword() {
  return useMutation({
    mutationFn: (payload: { password: string }) => verifyKioskDueManagementAccessPassword(payload)
  });
}
