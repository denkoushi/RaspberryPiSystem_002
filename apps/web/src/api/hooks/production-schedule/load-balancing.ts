import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import {
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
  getKioskProductionScheduleLoadBalancingWorkspace,
  getKioskProductionScheduleLoadBalancingWorkspaceDay,
  putKioskProductionScheduleLoadBalancingCapacityBase
} from '../../client';

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
    }
  });
}

export function useKioskProductionScheduleLoadBalancingWorkspace(
  params: { fromMonth: string; toMonth: string; targetDeviceScopeKey?: string },
  options?: { enabled?: boolean }
) {
  return useQuery({
    queryKey: ['kiosk-production-schedule-load-balancing-workspace', params],
    queryFn: () => getKioskProductionScheduleLoadBalancingWorkspace(params),
    enabled: options?.enabled ?? true,
    staleTime: 120_000,
    placeholderData: (previousData) => previousData
  });
}

export function useKioskProductionScheduleLoadBalancingWorkspaceDay(
  params: { month: string; resourceCd: string; fromMonth?: string; toMonth?: string; targetDeviceScopeKey?: string },
  options?: { enabled?: boolean }
) {
  return useQuery({
    queryKey: ['kiosk-production-schedule-load-balancing-workspace-day', params],
    queryFn: () => getKioskProductionScheduleLoadBalancingWorkspaceDay(params),
    enabled: options?.enabled ?? true,
    staleTime: 120_000
  });
}

export function usePutKioskProductionScheduleLoadBalancingCapacityBase() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: putKioskProductionScheduleLoadBalancingCapacityBase,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['kiosk-production-schedule-load-balancing-workspace'] });
      void queryClient.invalidateQueries({ queryKey: ['kiosk-production-schedule-load-balancing-workspace-day'] });
    }
  });
}
