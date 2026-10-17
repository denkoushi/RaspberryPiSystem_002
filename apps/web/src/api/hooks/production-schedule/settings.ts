import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import {
  getKioskProductionScheduleOrderSplitStatus,
  getProductionScheduleResourceCategorySettings,
  getProductionScheduleResourceCodeMappings,
  importProductionScheduleResourceCodeMappingsFromCsv,
  getProductionScheduleDueManagementAccessPasswordSettings,
  getProductionScheduleOrderSplitPilotSettings,
  getProductionScheduleProcessingTypeOptions,
  updateProductionScheduleResourceCategorySettings,
  updateProductionScheduleResourceCodeMappings,
  updateProductionScheduleDueManagementAccessPassword,
  updateProductionScheduleOrderSplitPilotSettings,
  updateProductionScheduleProcessingTypeOptions
} from '../../client';

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
