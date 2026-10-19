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
import { productionScheduleQueryKeys } from '../../queryKeys/productionSchedule';

export function useProductionScheduleResourceCategorySettings(location: string) {
  return useQuery({
    queryKey: productionScheduleQueryKeys.resourceCategorySettings(location),
    queryFn: () => getProductionScheduleResourceCategorySettings(location),
    enabled: location.trim().length > 0
  });
}

export function useProductionScheduleDueManagementAccessPasswordSettings(location: string) {
  return useQuery({
    queryKey: productionScheduleQueryKeys.dueManagementAccessPasswordSettings(location),
    queryFn: () => getProductionScheduleDueManagementAccessPasswordSettings(location),
    enabled: location.trim().length > 0
  });
}

export function useProductionScheduleOrderSplitPilotSettings() {
  return useQuery({
    queryKey: productionScheduleQueryKeys.orderSplitPilotSettingsAll,
    queryFn: getProductionScheduleOrderSplitPilotSettings
  });
}

export function useProductionScheduleProcessingTypeOptions(location: string) {
  return useQuery({
    queryKey: productionScheduleQueryKeys.processingTypeOptions(location),
    queryFn: () => getProductionScheduleProcessingTypeOptions(location),
    enabled: location.trim().length > 0
  });
}

export function useProductionScheduleResourceCodeMappings(location: string) {
  return useQuery({
    queryKey: productionScheduleQueryKeys.resourceCodeMappings(location),
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
      void queryClient.invalidateQueries({ queryKey: productionScheduleQueryKeys.resourceCategorySettings(settings.location) });
      void queryClient.invalidateQueries({ queryKey: productionScheduleQueryKeys.resourcesAll });
      void queryClient.invalidateQueries({ queryKey: productionScheduleQueryKeys.progressOverviewAll });
      void queryClient.invalidateQueries({ queryKey: productionScheduleQueryKeys.scheduleAll });
      void queryClient.invalidateQueries({ queryKey: productionScheduleQueryKeys.dueManagementSummaryAll });
    }
  });
}

export function useUpdateProductionScheduleDueManagementAccessPassword() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (payload: { location: string; password: string }) => updateProductionScheduleDueManagementAccessPassword(payload),
    onSuccess: (settings) => {
      void queryClient.invalidateQueries({
        queryKey: productionScheduleQueryKeys.dueManagementAccessPasswordSettings(settings.location)
      });
    }
  });
}

export function useUpdateProductionScheduleOrderSplitPilotSettings() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (payload: { enabled: boolean }) => updateProductionScheduleOrderSplitPilotSettings(payload),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: productionScheduleQueryKeys.orderSplitPilotSettingsAll });
      void queryClient.invalidateQueries({ queryKey: productionScheduleQueryKeys.orderSplitStatusAll });
      void queryClient.invalidateQueries({ queryKey: productionScheduleQueryKeys.scheduleAll });
    }
  });
}

export function useKioskProductionScheduleOrderSplitStatus() {
  return useQuery({
    queryKey: productionScheduleQueryKeys.orderSplitStatusAll,
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
      void queryClient.invalidateQueries({ queryKey: productionScheduleQueryKeys.processingTypeOptions(settings.location) });
      void queryClient.invalidateQueries({ queryKey: productionScheduleQueryKeys.kioskProcessingTypeOptionsAll });
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
      void queryClient.invalidateQueries({ queryKey: productionScheduleQueryKeys.resourceCodeMappings(settings.location) });
      void queryClient.invalidateQueries({ queryKey: productionScheduleQueryKeys.scheduleAll });
      void queryClient.invalidateQueries({ queryKey: productionScheduleQueryKeys.dueManagementSummaryAll });
      void queryClient.invalidateQueries({ queryKey: productionScheduleQueryKeys.dueManagementSeibanDetailAll });
    }
  });
}

export function useImportProductionScheduleResourceCodeMappingsFromCsv() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (payload: { location: string; csvText: string; dryRun: boolean }) =>
      importProductionScheduleResourceCodeMappingsFromCsv(payload),
    onSuccess: (_result, variables) => {
      void queryClient.invalidateQueries({ queryKey: productionScheduleQueryKeys.resourceCodeMappings(variables.location) });
      void queryClient.invalidateQueries({ queryKey: productionScheduleQueryKeys.scheduleAll });
      void queryClient.invalidateQueries({ queryKey: productionScheduleQueryKeys.dueManagementSummaryAll });
      void queryClient.invalidateQueries({ queryKey: productionScheduleQueryKeys.dueManagementSeibanDetailAll });
    }
  });
}
