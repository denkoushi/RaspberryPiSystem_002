import { useMutation, useQuery, useQueryClient, type QueryKey } from '@tanstack/react-query';

import { kioskDocumentDetailQueryKey } from '../features/kiosk/documents/kioskDocumentQueryKeys';
import {
  findProcessingOrderForRow,
  patchOrderUsageForProcessingOrderChange,
  patchScheduleListProcessingOrder
} from '../features/kiosk/productionSchedule/cache/kioskProductionScheduleOrderCachePatch';

import {
  getBackupHistory,
  getBackupHistoryById,
  restoreFromDropbox,
  restoreDryRun,
  getCsvImportSchedules,
  createCsvImportSchedule,
  updateCsvImportSchedule,
  deleteCsvImportSchedule,
  runCsvImportSchedule,
  getBackupConfig,
  updateBackupConfig,
  addBackupTarget,
  updateBackupTarget,
  deleteBackupTarget,
  runBackup,
  getBackupConfigHealth,
  getBackupConfigHistory,
  getBackupConfigHistoryById,
  getBackupTargetTemplates,
  addBackupTargetFromTemplate,
  getCsvImportSubjectPatterns,
  createCsvImportSubjectPattern,
  updateCsvImportSubjectPattern,
  deleteCsvImportSubjectPattern,
  reorderCsvImportSubjectPatterns,
  getCsvImportConfigs,
  getCsvImportConfig,
  upsertCsvImportConfig,
  getGmailConfig,
  updateGmailConfig,
  deleteGmailConfig,
  getGmailOAuthAuthorizeUrl,
  refreshGmailToken,
  type BackupHistoryFilters,
  type RestoreFromDropboxRequest,
  type BackupTarget,
  type RunBackupRequest,
  type GmailConfigUpdateRequest,
  type CsvImportSubjectPatternType,
  type CsvImportSubjectPattern,
  type CsvImportConfigType,
  type CsvImportColumnDefinition,
  type CsvImportStrategy
} from './backup';
import {
  borrowItem,
  cancelLoan,
  completeKioskProductionScheduleRow,
  createEmployee,
  createItem,
  deleteEmployee,
  deleteItem,
  deleteLoan,
  getActiveLoans,
  listPhotoLabelReviews,
  patchPhotoLabelReview,
  postPhotoGallerySeed,
  getPhotoSimilarCandidates,
  getClients,
  getClientLogs,
  getClientStatuses,
  getClientAlerts,
  acknowledgeAlert,
  getDepartments,
  getEmployees,
  getItems,
  getMachines,
  getUninspectedMachines,
  createMachine,
  updateMachine,
  deleteMachine,
  type CreateMachineInput,
  type UpdateMachineInput,
  getKioskConfig,
  getKioskEmployees,
  getKioskProductionSchedule,
  getKioskProductionScheduleOrderSearchCandidates,
  getKioskProductionScheduleOrderUsage,
  getKioskProductionScheduleResources,
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
  getKioskProductionScheduleProcessingTypeOptions,
  getKioskProductionScheduleSearchState,
  getKioskProductionScheduleSearchHistory,
  getKioskProductionScheduleHistoryProgress,
  getProductionScheduleResourceCategorySettings,
  getProductionScheduleResourceCodeMappings,
  importProductionScheduleResourceCodeMappingsFromCsv,
  getProductionScheduleDueManagementAccessPasswordSettings,
  getProductionScheduleProcessingTypeOptions,
  getKioskCallTargets,
  getSystemInfo,
  getTransactions,
  importMaster,
  importMasterSingle,
  photoBorrow,
  returnLoan,
  setKioskProductionScheduleSearchState,
  setKioskProductionScheduleSearchHistory,
  updateProductionScheduleResourceCategorySettings,
  updateProductionScheduleResourceCodeMappings,
  updateProductionScheduleDueManagementAccessPassword,
  updateProductionScheduleProcessingTypeOptions,
  updateClient,
  updateEmployee,
  updateItem,
  updateKioskProductionScheduleOrder,
  updateKioskProductionScheduleNote,
  updateKioskProductionScheduleDueDate,
  updateKioskProductionScheduleProcessing,
  updateKioskProductionScheduleDueManagementSeibanDueDate,
  updateKioskProductionScheduleDueManagementSeibanProcessingDueDate,
  updateKioskProductionScheduleDueManagementPartPriorities,
  updateKioskProductionScheduleDueManagementPartProcessingType,
  updateKioskProductionScheduleDueManagementPartNote,
  updateKioskProductionScheduleDueManagementTriageSelection,
  updateKioskProductionScheduleDueManagementDailyPlan,
  updateKioskProductionScheduleDueManagementGlobalRank,
  verifyKioskDueManagementAccessPassword,
  getDeployStatus,
  type CancelPayload,
  type PhotoBorrowPayload,
  type PhotoLabelReviewQuality,
  getSignageSchedules,
  getSignageSchedulesForManagement,
  createSignageSchedule,
  updateSignageSchedule,
  deleteSignageSchedule,
  getSignagePdfs,
  renderSignage,
  getSignageRenderStatus,
  uploadSignagePdf,
  updateSignagePdf,
  deleteSignagePdf,
  getKioskDocuments,
  getKioskDocumentDetail,
  uploadKioskDocument,
  deleteKioskDocument,
  patchKioskDocumentEnabled,
  patchKioskDocumentMetadata,
  reprocessKioskDocument,
  triggerKioskDocumentGmailIngest,
  getSignageEmergency,
  setSignageEmergency,
  getSignageContent,
  getCsvDashboards,
  getVisualizationDashboards,
  getVisualizationDashboard,
  createVisualizationDashboard,
  updateVisualizationDashboard,
  deleteVisualizationDashboard,
  type SignageSchedule,
  type SignagePdf,
  type KioskDocumentSource,
  type KioskDocumentOcrStatus,
  type ClientLogLevel,
  getNetworkModeStatus,
  getMeasuringInstruments,
  getMeasuringInstrument,
  createMeasuringInstrument,
  updateMeasuringInstrument,
  deleteMeasuringInstrument,
  getInspectionItems,
  createInspectionItem,
  updateInspectionItem,
  deleteInspectionItem,
  getInstrumentTags,
  createInstrumentTag,
  deleteInstrumentTag,
  getInspectionRecords,
  createInspectionRecord,
  borrowMeasuringInstrument,
  returnMeasuringInstrument,
  getUnifiedItems,
  type UnifiedListParams,
  type MeasuringInstrumentInput,
  getRiggingGears,
  createRiggingGear,
  updateRiggingGear,
  deleteRiggingGear,
  createRiggingInspectionRecord
} from './client';
import {
  KIOSK_DOCUMENT_DETAIL_GC_TIME_MS,
  KIOSK_DOCUMENT_DETAIL_STALE_TIME_MS,
} from './kioskDocumentDetailQueryOptions';

import type {
  BorrowPayload,
  Employee,
  Item,
  ReturnPayload,
  MeasuringInstrumentStatus,
  InspectionItem,
  MeasuringInstrumentBorrowPayload,
  MeasuringInstrumentReturnPayload,
  InspectionRecordCreatePayload,
  RiggingGear,
  RiggingStatus,
  RiggingInspectionRecord,
  RiggingInspectionResult
} from './types';
import type { KioskProductionScheduleListCache } from '../features/kiosk/productionSchedule/cache/kioskProductionScheduleListCache';

export function useDepartments() {
  return useQuery({
    queryKey: ['departments'],
    queryFn: getDepartments
  });
}

export function useEmployees() {
  return useQuery({
    queryKey: ['employees'],
    queryFn: getEmployees
  });
}

export function useMachines(params?: { search?: string; operatingStatus?: string }) {
  return useQuery({
    queryKey: ['machines', params],
    queryFn: () => getMachines(params),
  });
}

export function useUninspectedMachines(params?: { csvDashboardId?: string; date?: string }, options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: ['machines-uninspected', params],
    queryFn: () =>
      getUninspectedMachines({
        csvDashboardId: params?.csvDashboardId ?? '',
        date: params?.date,
      }),
    enabled: (options?.enabled ?? true) && Boolean(params?.csvDashboardId),
  });
}

export function useMachineMutations() {
  const queryClient = useQueryClient();
  const create = useMutation({
    mutationFn: (payload: CreateMachineInput) => createMachine(payload),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['machines'] })
  });
  const update = useMutation({
    mutationFn: ({ id, payload }: { id: string; payload: UpdateMachineInput }) => updateMachine(id, payload),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['machines'] })
  });
  const remove = useMutation({
    mutationFn: (id: string) => deleteMachine(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['machines'] })
  });
  return { create, update, remove };
}

export function useKioskEmployees(clientKey?: string) {
  return useQuery({
    queryKey: ['kiosk-employees', clientKey],
    queryFn: () => getKioskEmployees(clientKey),
    enabled: !!clientKey
  });
}

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
  },
  options?: { enabled?: boolean; pauseRefetch?: boolean }
) {
  return useQuery({
    queryKey: ['kiosk-production-schedule', params],
    queryFn: () => getKioskProductionSchedule(params),
    // 仕掛中が頻繁に変わるため軽く自動更新
    // NOTE: 書き込み操作（完了/未完了戻し/納期/備考/順番/処理など）と同時に走ると体感遅延が出やすいので、
    //       操作中はポーリングを止め、操作完了後に invalidate で再取得させる。
    refetchInterval: options?.pauseRefetch ? false : 30000,
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
    queryKey: ['kiosk-production-schedule-order-search', params],
    queryFn: () => getKioskProductionScheduleOrderSearchCandidates(params!),
    enabled: (options?.enabled ?? true) && Boolean(params)
  });
}

export function useKioskProductionScheduleResources(options?: { pauseRefetch?: boolean }) {
  return useQuery({
    queryKey: ['kiosk-production-schedule-resources'],
    queryFn: getKioskProductionScheduleResources,
    refetchInterval: options?.pauseRefetch ? false : 60000,
  });
}

export function useKioskProductionScheduleProcessingTypeOptions(options?: { pauseRefetch?: boolean }) {
  return useQuery({
    queryKey: ['kiosk-production-schedule-processing-type-options'],
    queryFn: getKioskProductionScheduleProcessingTypeOptions,
    refetchInterval: options?.pauseRefetch ? false : 60000
  });
}

export function useKioskProductionScheduleOrderUsage(
  resourceCds?: string,
  options?: { pauseRefetch?: boolean; targetDeviceScopeKey?: string; enabled?: boolean }
) {
  return useQuery({
    queryKey: ['kiosk-production-schedule-order-usage', resourceCds, options?.targetDeviceScopeKey],
    queryFn: () =>
      getKioskProductionScheduleOrderUsage({
        ...(resourceCds ? { resourceCds } : {}),
        ...(options?.targetDeviceScopeKey ? { targetDeviceScopeKey: options.targetDeviceScopeKey } : {})
      }),
    refetchInterval: options?.pauseRefetch ? false : 15000,
    enabled: options?.enabled ?? true
  });
}

export function useKioskProductionScheduleSearchState(options?: { pauseRefetch?: boolean }) {
  return useQuery({
    queryKey: ['kiosk-production-schedule-search-state'],
    queryFn: getKioskProductionScheduleSearchState,
    refetchInterval: options?.pauseRefetch ? false : 4000,
  });
}

export function useKioskProductionScheduleSearchHistory(options?: { pauseRefetch?: boolean }) {
  return useQuery({
    queryKey: ['kiosk-production-schedule-search-history'],
    queryFn: getKioskProductionScheduleSearchHistory,
    refetchInterval: options?.pauseRefetch ? false : 4000,
  });
}

export function useKioskProductionScheduleHistoryProgress(options?: { pauseRefetch?: boolean }) {
  return useQuery({
    queryKey: ['kiosk-production-schedule-history-progress'],
    queryFn: getKioskProductionScheduleHistoryProgress,
    refetchInterval: options?.pauseRefetch ? false : 30000,
  });
}

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
  options?: { enabled?: boolean }
) {
  return useQuery({
    queryKey: ['kiosk-production-schedule-manual-order-site-devices', siteKey],
    queryFn: () => getKioskProductionScheduleManualOrderSiteDevices(siteKey!),
    enabled: (options?.enabled ?? true) && Boolean(siteKey && siteKey.trim().length > 0)
  });
}

export function useKioskProductionScheduleManualOrderResourceAssignments(
  siteKey: string | undefined,
  options?: { enabled?: boolean }
) {
  return useQuery({
    queryKey: ['kiosk-production-schedule-manual-order-resource-assignments', siteKey],
    queryFn: () => getKioskProductionScheduleManualOrderResourceAssignments(siteKey!),
    enabled: (options?.enabled ?? true) && Boolean(siteKey && siteKey.trim().length > 0),
    refetchInterval: 30000
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

export function useVerifyKioskDueManagementAccessPassword() {
  return useMutation({
    mutationFn: (payload: { password: string }) => verifyKioskDueManagementAccessPassword(payload)
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
  return useMutation({
    mutationKey: ['kiosk-production-schedule', 'write', 'search-history'],
    mutationFn: (history: Parameters<typeof setKioskProductionScheduleSearchHistory>[0]) =>
      setKioskProductionScheduleSearchHistory(history),
  });
}

export type KioskProductionScheduleOrderCachePolicy = 'default' | 'leaderBoardFastPath';

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

export function useUpdateKioskProductionScheduleOrder() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationKey: ['kiosk-production-schedule', 'write', 'order'],
    mutationFn: ({ rowId, payload }: UpdateKioskProductionScheduleOrderVariables) =>
      updateKioskProductionScheduleOrder(rowId, payload),
    onMutate: async (variables): Promise<ProductionScheduleOrderRollbackContext | undefined> => {
      // NOTE: cancelQueries は「進行中の取得」と「更新」が競合しやすい場面で有効。
      //       ただし await すると、取得側が即時キャンセルに対応していない場合に体感待ちを作るため、
      //       ここでは await せず投げっぱなしにする（更新完了後に invalidate で整合を取る）。
      void queryClient.cancelQueries({ queryKey: ['kiosk-production-schedule'] });
      void queryClient.cancelQueries({ queryKey: ['kiosk-production-schedule-order-usage'] });

      const policy = variables.cachePolicy ?? 'default';
      if (policy !== 'leaderBoardFastPath') {
        return undefined;
      }

      const scheduleSnapshots = queryClient.getQueriesData({
        queryKey: ['kiosk-production-schedule']
      });
      const usageSnapshots = queryClient.getQueriesData({
        queryKey: ['kiosk-production-schedule-order-usage']
      });

      let previousOrder: number | null = null;
      let rowFoundInScheduleCache = false;
      for (const [, data] of scheduleSnapshots) {
        if (!data || typeof data !== 'object' || !('rows' in data)) continue;
        const rows = (data as KioskProductionScheduleListCache).rows;
        if (!Array.isArray(rows) || !rows.some((r) => r.id === variables.rowId)) continue;
        rowFoundInScheduleCache = true;
        previousOrder = findProcessingOrderForRow(rows, variables.rowId);
        break;
      }

      const nextOrder = variables.payload.orderNumber;
      const resourceCd = variables.payload.resourceCd;

      queryClient.setQueriesData<KioskProductionScheduleListCache>(
        { queryKey: ['kiosk-production-schedule'] },
        (old) => {
          if (!old) return old;
          return patchScheduleListProcessingOrder(old, variables.rowId, nextOrder);
        }
      );

      // usage は「一覧キャッシュ上で当該行を特定できたとき」だけ楽観パッチする。
      // 行が無いのに next だけ足すと占有表示がズレうる（ロールバックで一覧は戻るが usage は誤り得る）。
      if (rowFoundInScheduleCache) {
        queryClient.setQueriesData<Record<string, number[]>>(
          { queryKey: ['kiosk-production-schedule-order-usage'] },
          (old) => {
            if (!old) return old;
            return patchOrderUsageForProcessingOrderChange(old, resourceCd, previousOrder, nextOrder);
          }
        );
      }

      return { scheduleSnapshots, usageSnapshots };
    },
    onSuccess: (data, variables) => {
      const policy = variables.cachePolicy ?? 'default';
      if (policy === 'leaderBoardFastPath') {
        const serverOrder = data.orderNumber ?? null;
        queryClient.setQueriesData<KioskProductionScheduleListCache>(
          { queryKey: ['kiosk-production-schedule'] },
          (old) => {
            if (!old) return old;
            return patchScheduleListProcessingOrder(old, variables.rowId, serverOrder);
          }
        );
        return;
      }
      // UI待ちを作らない（mutation完了は即返し、裏で再取得）
      void queryClient.invalidateQueries({ queryKey: ['kiosk-production-schedule'] });
      void queryClient.invalidateQueries({ queryKey: ['kiosk-production-schedule-order-usage'] });
      void queryClient.invalidateQueries({
        queryKey: ['kiosk-production-schedule-due-management-manual-order-overview']
      });
    },
    onError: (_err, variables, context) => {
      const policy = variables.cachePolicy ?? 'default';
      if (policy !== 'leaderBoardFastPath') return;
      const ctx = context as ProductionScheduleOrderRollbackContext | undefined;
      if (!ctx) return;
      for (const [key, snap] of ctx.scheduleSnapshots) {
        queryClient.setQueryData(key, snap);
      }
      for (const [key, snap] of ctx.usageSnapshots) {
        queryClient.setQueryData(key, snap);
      }
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
      void queryClient.cancelQueries({ queryKey: ['kiosk-production-schedule'] });
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
      }>({ queryKey: ['kiosk-production-schedule'] }, (oldData) => {
        if (!oldData) return oldData;
        return {
          ...oldData,
          rows: oldData.rows.map((row) =>
            row.id === rowId ? { ...row, note: data.note } : row
          )
        };
      });
      void queryClient.invalidateQueries({ queryKey: ['kiosk-production-schedule'] });
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
      void queryClient.cancelQueries({ queryKey: ['kiosk-production-schedule'] });
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
      }>({ queryKey: ['kiosk-production-schedule'] }, (oldData) => {
        if (!oldData) return oldData;
        return {
          ...oldData,
          rows: oldData.rows.map((row) =>
            row.id === rowId ? { ...row, dueDate: data.dueDate } : row
          )
        };
      });
      void queryClient.invalidateQueries({ queryKey: ['kiosk-production-schedule'] });
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
      void queryClient.cancelQueries({ queryKey: ['kiosk-production-schedule'] });
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
      }>({ queryKey: ['kiosk-production-schedule'] }, (oldData) => {
        if (!oldData) return oldData;
        return {
          ...oldData,
          rows: oldData.rows.map((row) =>
            row.id === rowId ? { ...row, processingType: data.processingType } : row
          )
        };
      });
      void queryClient.invalidateQueries({ queryKey: ['kiosk-production-schedule'] });
    }
  });
}

export function useCompleteKioskProductionScheduleRow() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationKey: ['kiosk-production-schedule', 'write', 'complete'],
    mutationFn: (rowId: string) => completeKioskProductionScheduleRow(rowId),
    onMutate: () => {
      void queryClient.cancelQueries({ queryKey: ['kiosk-production-schedule'] });
      void queryClient.cancelQueries({ queryKey: ['kiosk-production-schedule-order-usage'] });
    },
    onSuccess: (data, rowId) => {
      // Optimistic Update: キャッシュを直接更新して即座にUIを更新
      queryClient.setQueriesData<{
        page: number;
        pageSize: number;
        total: number;
        rows: Array<{ id: string; occurredAt: string | Date; rowData: unknown; processingOrder?: number | null; note?: string | null }>;
      }>(
        { queryKey: ['kiosk-production-schedule'] },
        (oldData) => {
          if (!oldData) return oldData;
          return {
            ...oldData,
            rows: oldData.rows.map((row) =>
              row.id === rowId
                ? { ...row, rowData: data.rowData }
                : row
            )
          };
        }
      );
      // バックグラウンドで再取得（エラー時の整合性確保）
      void queryClient.invalidateQueries({ queryKey: ['kiosk-production-schedule'] });
      void queryClient.invalidateQueries({ queryKey: ['kiosk-production-schedule-order-usage'] });
      void queryClient.invalidateQueries({
        queryKey: ['kiosk-production-schedule-due-management-manual-order-overview']
      });
    }
  });
}

export function useEmployeeMutations() {
  const queryClient = useQueryClient();
  const create = useMutation({
    mutationFn: (payload: Partial<Employee>) => createEmployee(payload),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['employees'] })
  });
  const update = useMutation({
    mutationFn: ({ id, payload }: { id: string; payload: Partial<Employee> }) => updateEmployee(id, payload),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['employees'] })
  });
  const remove = useMutation({
    mutationFn: (id: string) => deleteEmployee(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['employees'] })
  });
  return { create, update, remove };
}

export function useItems() {
  return useQuery({
    queryKey: ['items'],
    queryFn: getItems
  });
}

export function useItemMutations() {
  const queryClient = useQueryClient();
  const create = useMutation({
    mutationFn: (payload: Partial<Item>) => createItem(payload),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['items'] })
  });
  const update = useMutation({
    mutationFn: ({ id, payload }: { id: string; payload: Partial<Item> }) => updateItem(id, payload),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['items'] })
  });
  const remove = useMutation({
    mutationFn: (id: string) => deleteItem(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['items'] })
  });
  return { create, update, remove };
}

export function useActiveLoans(clientId?: string, clientKey?: string, options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: ['loans', clientId, clientKey],
    queryFn: () => getActiveLoans(clientId, clientKey),
    refetchInterval: 30000, // 30秒ごとに自動更新（12時間経過の状態をリアルタイムで反映）
    placeholderData: (previousData) => previousData,
    enabled: options?.enabled !== false // デフォルトはtrue、明示的にfalseが指定された場合のみ無効化
  });
}

export function usePhotoLabelReviews(limit = 50) {
  return useQuery({
    queryKey: ['photo-label-reviews', limit],
    queryFn: () => listPhotoLabelReviews(limit),
  });
}

export function usePatchPhotoLabelReview() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (args: {
      loanId: string;
      quality: PhotoLabelReviewQuality;
      humanDisplayName?: string | null;
    }) => patchPhotoLabelReview(args.loanId, { quality: args.quality, humanDisplayName: args.humanDisplayName }),
    onSuccess: (_data, args) => {
      queryClient.invalidateQueries({ queryKey: ['photo-label-reviews'] });
      queryClient.invalidateQueries({ queryKey: ['loans'] });
      queryClient.invalidateQueries({ queryKey: ['photo-similar-candidates', args.loanId] });
    },
  });
}

export function usePostPhotoGallerySeed() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (args: { image: File; canonicalLabel: string }) => postPhotoGallerySeed(args),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['photo-label-reviews'] });
      queryClient.invalidateQueries({ queryKey: ['loans'] });
      queryClient.invalidateQueries({ queryKey: ['photo-similar-candidates', data.loanId] });
    },
  });
}

export function usePhotoSimilarCandidates(loanId: string, options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: ['photo-similar-candidates', loanId],
    queryFn: () => getPhotoSimilarCandidates(loanId),
    enabled: options?.enabled !== false && Boolean(loanId),
  });
}

export function useBorrowMutation(clientKey?: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (payload: BorrowPayload) => borrowItem(payload, clientKey),
    onSuccess: () => {
      // 貸出成功後、すべてのloansクエリを無効化して最新データを取得
      queryClient.invalidateQueries({ queryKey: ['loans'] });
    }
  });
}

export function useReturnMutation(clientKey?: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (payload: ReturnPayload) => returnLoan(payload, clientKey),
    onSuccess: () => {
      // 返却成功後、すべてのloansクエリを無効化して最新データを取得
      queryClient.invalidateQueries({ queryKey: ['loans'] });
    }
  });
}

export function useDeleteLoanMutation(clientKey?: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (loanId: string) => deleteLoan(loanId, clientKey),
    onSuccess: () => {
      // 削除成功後、すべてのloansクエリを無効化して最新データを取得
      queryClient.invalidateQueries({ queryKey: ['loans'] });
    }
  });
}

export function useCancelLoanMutation(clientKey?: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (payload: CancelPayload) => cancelLoan(payload, clientKey),
    onSuccess: () => {
      // 取消成功後、すべてのloansクエリを無効化して最新データを取得
      queryClient.invalidateQueries({ queryKey: ['loans'] });
    }
  });
}

export function usePhotoBorrowMutation(clientKey?: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (payload: PhotoBorrowPayload) => photoBorrow(payload, clientKey),
    onSuccess: () => {
      // 写真撮影持出成功後、すべてのloansクエリを無効化して最新データを取得
      queryClient.invalidateQueries({ queryKey: ['loans'] });
    }
  });
}

export function useTransactions(
  page: number,
  filters?: { startDate?: string; endDate?: string; employeeId?: string; itemId?: string; clientId?: string }
) {
  return useQuery({
    queryKey: ['transactions', page, filters],
    queryFn: () => getTransactions(page, filters),
    placeholderData: (previousData) => previousData
  });
}

// 計測機器
export function useMeasuringInstruments(filters?: { search?: string; status?: MeasuringInstrumentStatus }) {
  return useQuery({
    queryKey: ['measuring-instruments', filters],
    queryFn: () => getMeasuringInstruments(filters),
    placeholderData: (previous) => previous
  });
}

export function useMeasuringInstrument(id?: string) {
  return useQuery({
    queryKey: ['measuring-instrument', id],
    queryFn: () => getMeasuringInstrument(id!),
    enabled: !!id
  });
}

export function useMeasuringInstrumentMutations() {
  const queryClient = useQueryClient();
  const create = useMutation({
    mutationFn: (payload: MeasuringInstrumentInput) => createMeasuringInstrument(payload),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['measuring-instruments'] })
  });
  const update = useMutation({
    mutationFn: ({ id, payload }: { id: string; payload: MeasuringInstrumentInput }) =>
      updateMeasuringInstrument(id, payload),
    onSuccess: (_, vars) => {
      queryClient.invalidateQueries({ queryKey: ['measuring-instruments'] });
      queryClient.invalidateQueries({ queryKey: ['measuring-instrument', vars.id] });
      // rfidTagUid はタグテーブル側で管理されるため、タグ一覧も更新する
      queryClient.invalidateQueries({ queryKey: ['instrument-tags', vars.id] });
    }
  });
  const remove = useMutation({
    mutationFn: (id: string) => deleteMeasuringInstrument(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['measuring-instruments'] })
  });
  return { create, update, remove };
}

// 点検項目
export function useInspectionItems(measuringInstrumentId?: string) {
  return useQuery({
    queryKey: ['inspection-items', measuringInstrumentId],
    queryFn: () => getInspectionItems(measuringInstrumentId!),
    enabled: !!measuringInstrumentId
  });
}

export function useInspectionItemMutations(measuringInstrumentId: string) {
  const queryClient = useQueryClient();
  const create = useMutation({
    mutationFn: (payload: Partial<InspectionItem>) => createInspectionItem(measuringInstrumentId, payload),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['inspection-items', measuringInstrumentId] })
  });
  const update = useMutation({
    mutationFn: ({ id, payload }: { id: string; payload: Partial<InspectionItem> }) =>
      updateInspectionItem(id, payload),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['inspection-items', measuringInstrumentId] })
  });
  const remove = useMutation({
    mutationFn: (id: string) => deleteInspectionItem(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['inspection-items', measuringInstrumentId] })
  });
  return { create, update, remove };
}

// RFIDタグ
export function useInstrumentTags(measuringInstrumentId?: string) {
  return useQuery({
    queryKey: ['instrument-tags', measuringInstrumentId],
    queryFn: () => getInstrumentTags(measuringInstrumentId!),
    enabled: !!measuringInstrumentId
  });
}

export function useInstrumentTagMutations(measuringInstrumentId: string) {
  const queryClient = useQueryClient();
  const create = useMutation({
    mutationFn: (rfidTagUid: string) => createInstrumentTag(measuringInstrumentId, rfidTagUid),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['instrument-tags', measuringInstrumentId] })
  });
  const remove = useMutation({
    mutationFn: (tagId: string) => deleteInstrumentTag(tagId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['instrument-tags', measuringInstrumentId] })
  });
  return { create, remove };
}

// 点検記録
export function useInspectionRecords(
  measuringInstrumentId?: string,
  filters?: { startDate?: string; endDate?: string; employeeId?: string; result?: string }
) {
  return useQuery({
    queryKey: ['inspection-records', measuringInstrumentId, filters],
    queryFn: () => getInspectionRecords(measuringInstrumentId!, filters),
    enabled: !!measuringInstrumentId
  });
}

export function useInspectionRecordCreate() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (payload: InspectionRecordCreatePayload) => createInspectionRecord(payload),
    onSuccess: (_, vars) => {
      queryClient.invalidateQueries({ queryKey: ['inspection-records', vars.measuringInstrumentId] });
    }
  });
}

// 計測機器の持出/返却
export function useBorrowMeasuringInstrument(clientKey?: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (payload: MeasuringInstrumentBorrowPayload) => borrowMeasuringInstrument(payload, clientKey),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['loans'] })
  });
}

export function useReturnMeasuringInstrument(clientKey?: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (payload: MeasuringInstrumentReturnPayload) => returnMeasuringInstrument(payload, clientKey),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['loans'] })
  });
}

export function useKioskConfig() {
  return useQuery({
    queryKey: ['kiosk-config'],
    queryFn: getKioskConfig,
    staleTime: 0, // キャッシュを無効化して常に最新データを取得（設定変更時に即座に反映されるように）
    refetchInterval: 60000, // 60秒ごとにポーリング（温度表示用、Pi3/Pi4のリソースを浪費しない）
    refetchOnWindowFocus: true // ウィンドウフォーカス時にリフェッチ（設定変更時に即座に反映されるように）
  });
}

export function useClients() {
  return useQuery({
    queryKey: ['clients'],
    queryFn: getClients
  });
}

export function useClientMutations() {
  const queryClient = useQueryClient();
  const update = useMutation({
    mutationFn: ({ id, payload }: { id: string; payload: { name?: string; defaultMode?: 'PHOTO' | 'TAG' | null } }) =>
      updateClient(id, payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['clients'] });
      queryClient.invalidateQueries({ queryKey: ['kiosk-config'] });
    }
  });
  return { update };
}

export function useClientStatuses() {
  return useQuery({
    queryKey: ['client-status'],
    queryFn: getClientStatuses,
    refetchInterval: 60_000
  });
}

export function useKioskCallTargets() {
  return useQuery({
    queryKey: ['kiosk-call-targets'],
    queryFn: getKioskCallTargets,
    refetchInterval: 60_000
  });
}

export function useClientLogs(filters: { clientId?: string; level?: ClientLogLevel; limit?: number; since?: string }) {
  return useQuery({
    queryKey: ['client-logs', filters],
    queryFn: () => getClientLogs(filters)
  });
}

export function useClientAlerts() {
  return useQuery({
    queryKey: ['client-alerts'],
    queryFn: getClientAlerts,
    refetchInterval: 60_000 // 1分ごとに更新
  });
}

export function useAcknowledgeAlert() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: acknowledgeAlert,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['client-alerts'] });
    }
  });
}

export function useImportMaster() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: importMaster,
    onSuccess: () => {
      // インポート成功後、employeesとitemsのクエリを無効化して最新データを取得
      queryClient.invalidateQueries({ queryKey: ['employees'] });
      queryClient.invalidateQueries({ queryKey: ['items'] });
    }
  });
}

export function useImportMasterSingle() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: importMasterSingle,
    onSuccess: (_, variables) => {
      // インポート成功後、該当するデータタイプのクエリを無効化して最新データを取得
      if (variables.type === 'employees') {
        queryClient.invalidateQueries({ queryKey: ['employees'] });
      } else if (variables.type === 'items') {
        queryClient.invalidateQueries({ queryKey: ['items'] });
      } else if (variables.type === 'measuringInstruments') {
        queryClient.invalidateQueries({ queryKey: ['measuringInstruments'] });
      } else if (variables.type === 'riggingGears') {
        queryClient.invalidateQueries({ queryKey: ['riggingGears'] });
      } else if (variables.type === 'machines') {
        queryClient.invalidateQueries({ queryKey: ['machines'] });
        queryClient.invalidateQueries({ queryKey: ['machines-uninspected'] });
      }
    }
  });
}

/**
 * システム情報（CPU温度・負荷）を取得するフック
 * 10秒間隔で自動更新
 */
export function useSystemInfo() {
  return useQuery({
    queryKey: ['system-info'],
    queryFn: getSystemInfo,
    refetchInterval: 10_000, // 10秒間隔で更新（CPU負荷軽減のため）
    staleTime: 3000, // 3秒間はキャッシュを使用
    refetchOnWindowFocus: true, // ウィンドウフォーカス時に更新
  });
}

export function useNetworkModeStatus() {
  return useQuery({
    queryKey: ['network-mode-status'],
    queryFn: getNetworkModeStatus,
    refetchInterval: 30_000,
    staleTime: 10_000,
    refetchOnWindowFocus: true
  });
}

export function useDeployStatus() {
  return useQuery({
    queryKey: ['deploy-status'],
    queryFn: getDeployStatus,
    refetchInterval: 5000, // 5秒ごとにポーリング（メンテナンス画面の表示/非表示を即座に反映）
    staleTime: 0, // キャッシュを無効化して常に最新データを取得
    refetchOnWindowFocus: true
  });
}

// デジタルサイネージ関連のフック
export function useSignageSchedules() {
  return useQuery({
    queryKey: ['signage-schedules'],
    queryFn: getSignageSchedules
  });
}

export function useSignageSchedulesForManagement() {
  return useQuery({
    queryKey: ['signage-schedules', 'management'],
    queryFn: getSignageSchedulesForManagement
  });
}

export function useSignageScheduleMutations() {
  const queryClient = useQueryClient();
  const invalidateSchedules = () => {
    void queryClient.invalidateQueries({ queryKey: ['signage-schedules'] });
  };
  const create = useMutation({
    mutationFn: createSignageSchedule,
    onSuccess: invalidateSchedules
  });
  const update = useMutation({
    mutationFn: ({ id, payload }: { id: string; payload: Partial<SignageSchedule> }) => updateSignageSchedule(id, payload),
    onSuccess: invalidateSchedules
  });
  const remove = useMutation({
    mutationFn: (id: string) => deleteSignageSchedule(id),
    onSuccess: invalidateSchedules
  });
  return { create, update, remove };
}

export function useSignagePdfs() {
  return useQuery({
    queryKey: ['signage-pdfs'],
    queryFn: getSignagePdfs
  });
}

export function useSignagePdfMutations() {
  const queryClient = useQueryClient();
  const upload = useMutation({
    mutationFn: uploadSignagePdf,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['signage-pdfs'] })
  });
  const update = useMutation({
    mutationFn: ({ id, payload }: { id: string; payload: Partial<SignagePdf> }) => updateSignagePdf(id, payload),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['signage-pdfs'] })
  });
  const remove = useMutation({
    mutationFn: (id: string) => deleteSignagePdf(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['signage-pdfs'] })
  });
  return { upload, update, remove };
}

export function useKioskDocuments(params?: {
  q?: string;
  sourceType?: KioskDocumentSource;
  ocrStatus?: KioskDocumentOcrStatus;
  includeCandidates?: boolean;
  hideDisabled?: boolean;
}) {
  return useQuery({
    queryKey: ['kiosk-documents', params],
    queryFn: () => getKioskDocuments(params),
  });
}

export function useKioskDocumentDetail(id: string | null) {
  return useQuery({
    queryKey: kioskDocumentDetailQueryKey(id),
    queryFn: () => getKioskDocumentDetail(id!),
    enabled: Boolean(id),
    staleTime: KIOSK_DOCUMENT_DETAIL_STALE_TIME_MS,
    gcTime: KIOSK_DOCUMENT_DETAIL_GC_TIME_MS,
  });
}

export function useKioskDocumentMutations() {
  const queryClient = useQueryClient();
  const upload = useMutation({
    mutationFn: uploadKioskDocument,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['kiosk-documents'] });
    },
  });
  const remove = useMutation({
    mutationFn: (id: string) => deleteKioskDocument(id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['kiosk-documents'] });
      void queryClient.invalidateQueries({ queryKey: ['kiosk-document'] });
    },
  });
  const setEnabled = useMutation({
    mutationFn: ({ id, enabled }: { id: string; enabled: boolean }) => patchKioskDocumentEnabled(id, enabled),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['kiosk-documents'] });
    },
  });
  const patchMetadata = useMutation({
    mutationFn: ({
      id,
      payload,
    }: {
      id: string;
      payload: {
        displayTitle?: string | null;
        confirmedFhincd?: string | null;
        confirmedDrawingNumber?: string | null;
        confirmedProcessName?: string | null;
        confirmedResourceCd?: string | null;
        confirmedDocumentNumber?: string | null;
        confirmedSummaryText?: string | null;
        documentCategory?: string | null;
      };
    }) => patchKioskDocumentMetadata(id, payload),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['kiosk-documents'] });
      void queryClient.invalidateQueries({ queryKey: ['kiosk-document'] });
    },
  });
  const reprocess = useMutation({
    mutationFn: (id: string) => reprocessKioskDocument(id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['kiosk-documents'] });
      void queryClient.invalidateQueries({ queryKey: ['kiosk-document'] });
    },
  });
  const ingestGmail = useMutation({
    mutationFn: (params?: { scheduleId?: string }) => triggerKioskDocumentGmailIngest(params),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['kiosk-documents'] });
    },
  });
  return { upload, remove, setEnabled, patchMetadata, reprocess, ingestGmail };
}

export function useSignageEmergency() {
  return useQuery({
    queryKey: ['signage-emergency'],
    queryFn: getSignageEmergency
  });
}

export function useSignageEmergencyMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: setSignageEmergency,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['signage-emergency'] })
  });
}

export function useSignageContent() {
  return useQuery({
    queryKey: ['signage-content'],
    queryFn: getSignageContent,
    refetchInterval: 30_000 // 30秒間隔で更新（サイネージ表示用）
  });
}

export function useSignageRenderStatus() {
  return useQuery({
    queryKey: ['signage-render-status'],
    queryFn: getSignageRenderStatus,
    refetchInterval: 10_000 // 10秒間隔で更新
  });
}

export function useSignageRenderMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: renderSignage,
    onSuccess: () => {
      // レンダリング成功後、ステータスを更新
      queryClient.invalidateQueries({ queryKey: ['signage-render-status'] });
    }
  });
}

export function useCsvDashboards(filters?: { enabled?: boolean; search?: string }) {
  return useQuery({
    queryKey: ['csv-dashboards', filters],
    queryFn: () => getCsvDashboards(filters)
  });
}

export function useVisualizationDashboards(filters?: { enabled?: boolean; search?: string }) {
  return useQuery({
    queryKey: ['visualization-dashboards', filters],
    queryFn: () => getVisualizationDashboards(filters)
  });
}

export function useVisualizationDashboard(id?: string | null) {
  return useQuery({
    queryKey: ['visualization-dashboard', id],
    queryFn: () => getVisualizationDashboard(id!),
    enabled: Boolean(id)
  });
}

export function useVisualizationDashboardMutations() {
  const queryClient = useQueryClient();
  const create = useMutation({
    mutationFn: createVisualizationDashboard,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['visualization-dashboards'] });
    }
  });
  const update = useMutation({
    mutationFn: ({ id, payload }: { id: string; payload: Parameters<typeof updateVisualizationDashboard>[1] }) =>
      updateVisualizationDashboard(id, payload),
    onSuccess: (dashboard) => {
      queryClient.invalidateQueries({ queryKey: ['visualization-dashboard', dashboard.id] });
      queryClient.invalidateQueries({ queryKey: ['visualization-dashboards'] });
    }
  });
  const remove = useMutation({
    mutationFn: (id: string) => deleteVisualizationDashboard(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['visualization-dashboards'] });
    }
  });
  return { create, update, remove };
}

export function useUnifiedItems(params?: UnifiedListParams) {
  return useQuery({
    queryKey: ['unified-items', params],
    queryFn: () => getUnifiedItems(params),
    placeholderData: (previous) => previous
  });
}

// 吊具
export function useRiggingGears(params?: { search?: string; status?: RiggingStatus }) {
  return useQuery({
    queryKey: ['rigging-gears', params],
    queryFn: () => getRiggingGears(params)
  });
}

export function useRiggingGearMutations() {
  const queryClient = useQueryClient();
  const create = useMutation({
    mutationFn: (payload: Partial<RiggingGear> & { name: string; managementNumber: string }) =>
      createRiggingGear(payload),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['rigging-gears'] })
  });
  const update = useMutation({
    mutationFn: ({ id, payload }: { id: string; payload: Partial<RiggingGear> }) => updateRiggingGear(id, payload),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['rigging-gears'] })
  });
  const remove = useMutation({
    mutationFn: (id: string) => deleteRiggingGear(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['rigging-gears'] })
  });
  return { create, update, remove };
}

export function useRiggingInspectionRecords(riggingGearId?: string) {
  return useQuery({
    queryKey: ['rigging-inspection-records', riggingGearId],
    queryFn: async () => {
      if (!riggingGearId) return [] as RiggingInspectionRecord[];
      const res = await fetch(
        `${import.meta.env.VITE_API_BASE_URL ?? '/api'}/rigging-gears/${riggingGearId}/inspection-records`,
        { headers: { 'Content-Type': 'application/json' } }
      );
      if (!res.ok) throw new Error('点検記録の取得に失敗しました');
      const json = await res.json();
      return json.inspectionRecords as RiggingInspectionRecord[];
    },
    enabled: Boolean(riggingGearId)
  });
}

export function useRiggingInspectionRecordMutations() {
  const queryClient = useQueryClient();
  const create = useMutation({
    mutationFn: (payload: {
      riggingGearId: string;
      loanId?: string | null;
      employeeId: string;
      result: RiggingInspectionResult;
      inspectedAt: string;
      notes?: string | null;
    }) => createRiggingInspectionRecord(payload),
    onSuccess: (_data, variables) =>
      queryClient.invalidateQueries({ queryKey: ['rigging-inspection-records', variables.riggingGearId] })
  });
  return { create };
}

// バックアップ履歴フック
export function useBackupHistory(filters?: BackupHistoryFilters) {
  return useQuery({
    queryKey: ['backup-history', filters],
    queryFn: () => getBackupHistory(filters)
  });
}

export function useBackupHistoryById(id: string) {
  return useQuery({
    queryKey: ['backup-history', id],
    queryFn: () => getBackupHistoryById(id),
    enabled: !!id
  });
}

export function useRestoreFromDropbox() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (request: RestoreFromDropboxRequest) => restoreFromDropbox(request),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['backup-history'] });
    }
  });
}

export function useRestoreDryRun() {
  return useMutation({
    mutationFn: (request: Parameters<typeof restoreDryRun>[0]) => restoreDryRun(request)
  });
}

// CSVインポートスケジュールフック
export function useCsvImportSchedules() {
  return useQuery({
    queryKey: ['csv-import-schedules'],
    queryFn: getCsvImportSchedules
  });
}

// バックアップ設定関連のフック
export function useBackupConfig() {
  return useQuery({
    queryKey: ['backup-config'],
    queryFn: getBackupConfig
  });
}

export function useCsvImportSubjectPatterns(importType?: CsvImportSubjectPatternType, dashboardId?: string) {
  return useQuery({
    queryKey: ['csv-import-subject-patterns', importType, dashboardId],
    queryFn: () => getCsvImportSubjectPatterns(importType, dashboardId)
  });
}

export function useCsvImportSubjectPatternMutations() {
  const queryClient = useQueryClient();
  const create = useMutation({
    mutationFn: (payload: {
      importType: CsvImportSubjectPatternType;
      dashboardId?: string | null;
      pattern: string;
      priority?: number;
      enabled?: boolean;
    }) => createCsvImportSubjectPattern(payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['csv-import-subject-patterns'] });
    }
  });

  const update = useMutation({
    mutationFn: (payload: {
      id: string;
      data: Partial<Pick<CsvImportSubjectPattern, 'pattern' | 'priority' | 'enabled'>>;
    }) => updateCsvImportSubjectPattern(payload.id, payload.data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['csv-import-subject-patterns'] });
    }
  });

  const remove = useMutation({
    mutationFn: (id: string) => deleteCsvImportSubjectPattern(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['csv-import-subject-patterns'] });
    }
  });

  const reorder = useMutation({
    mutationFn: (payload: { importType: CsvImportSubjectPatternType; dashboardId?: string | null; orderedIds: string[] }) =>
      reorderCsvImportSubjectPatterns(payload),
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ['csv-import-subject-patterns', variables.importType, variables.dashboardId] });
      queryClient.invalidateQueries({ queryKey: ['csv-import-subject-patterns'] });
    }
  });

  return { create, update, remove, reorder };
}

export function useCsvImportConfigs() {
  return useQuery({
    queryKey: ['csv-import-configs'],
    queryFn: getCsvImportConfigs
  });
}

export function useCsvImportConfig(importType: CsvImportConfigType) {
  return useQuery({
    queryKey: ['csv-import-config', importType],
    queryFn: () => getCsvImportConfig(importType),
  });
}

export function useCsvImportConfigMutations() {
  const queryClient = useQueryClient();
  const upsert = useMutation({
    mutationFn: ({
      importType,
      payload
    }: {
      importType: CsvImportConfigType;
      payload: {
        enabled: boolean;
        allowedManualImport: boolean;
        allowedScheduledImport: boolean;
        importStrategy: CsvImportStrategy;
        columnDefinitions: CsvImportColumnDefinition[];
      };
    }) => upsertCsvImportConfig(importType, payload),
    onSuccess: async (config) => {
      await queryClient.invalidateQueries({ queryKey: ['csv-import-config', config.importType] });
      await queryClient.invalidateQueries({ queryKey: ['csv-import-configs'] });
    }
  });

  return { upsert };
}

export function useBackupConfigHealth() {
  return useQuery({
    queryKey: ['backup-config-health'],
    queryFn: getBackupConfigHealth,
    refetchInterval: 60000 // 1分ごとに自動更新
  });
}

export function useBackupTargetTemplates() {
  return useQuery({
    queryKey: ['backup-target-templates'],
    queryFn: getBackupTargetTemplates
  });
}

export function useBackupConfigHistory(params?: { offset?: number; limit?: number }) {
  return useQuery({
    queryKey: ['backup-config-history', params],
    queryFn: () => getBackupConfigHistory(params)
  });
}

export function useBackupConfigHistoryById(id?: string) {
  return useQuery({
    queryKey: ['backup-config-history', id],
    queryFn: () => getBackupConfigHistoryById(id!),
    enabled: Boolean(id)
  });
}

export function useBackupConfigMutations() {
  const queryClient = useQueryClient();
  const updateConfig = useMutation({
    mutationFn: updateBackupConfig,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['backup-config'] });
      queryClient.invalidateQueries({ queryKey: ['backup-config-health'] });
    }
  });
  const addTarget = useMutation({
    mutationFn: addBackupTarget,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['backup-config'] });
      queryClient.invalidateQueries({ queryKey: ['backup-config-health'] });
    }
  });
  const updateTarget = useMutation({
    mutationFn: ({ index, target }: { index: number; target: Partial<BackupTarget> }) =>
      updateBackupTarget(index, target),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['backup-config'] });
      queryClient.invalidateQueries({ queryKey: ['backup-config-health'] });
    }
  });
  const deleteTarget = useMutation({
    mutationFn: (index: number) => deleteBackupTarget(index),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['backup-config'] });
      queryClient.invalidateQueries({ queryKey: ['backup-config-health'] });
    }
  });
  const runBackupMutation = useMutation({
    mutationFn: (request: RunBackupRequest) => runBackup(request),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['backup-history'] });
      queryClient.invalidateQueries({ queryKey: ['backup-config'] });
    }
  });
  const addFromTemplate = useMutation({
    mutationFn: (params: Parameters<typeof addBackupTargetFromTemplate>[0]) => addBackupTargetFromTemplate(params),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['backup-config'] });
      queryClient.invalidateQueries({ queryKey: ['backup-config-health'] });
      queryClient.invalidateQueries({ queryKey: ['backup-target-templates'] });
    }
  });
  return { updateConfig, addTarget, addFromTemplate, updateTarget, deleteTarget, runBackup: runBackupMutation };
}

export function useCsvImportScheduleMutations() {
  const queryClient = useQueryClient();
  const create = useMutation({
    mutationFn: (schedule: Parameters<typeof createCsvImportSchedule>[0]) => createCsvImportSchedule(schedule),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['csv-import-schedules'] })
  });
  const update = useMutation({
    mutationFn: ({ id, schedule }: { id: string; schedule: Parameters<typeof updateCsvImportSchedule>[1] }) =>
      updateCsvImportSchedule(id, schedule),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['csv-import-schedules'] })
  });
  const remove = useMutation({
    mutationFn: (id: string) => deleteCsvImportSchedule(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['csv-import-schedules'] })
  });
  const run = useMutation({
    mutationFn: (id: string) => runCsvImportSchedule(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['csv-import-schedules'] });
      queryClient.invalidateQueries({ queryKey: ['import-history'] });
      queryClient.invalidateQueries({ queryKey: ['backup-history'] });
    }
  });
  return { create, update, remove, run };
}

// Gmail設定関連のフック
export function useGmailConfig() {
  return useQuery({
    queryKey: ['gmail-config'],
    queryFn: getGmailConfig
  });
}

export function useGmailConfigMutations() {
  const queryClient = useQueryClient();
  const update = useMutation({
    mutationFn: (config: GmailConfigUpdateRequest) => updateGmailConfig(config),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['gmail-config'] })
  });
  const remove = useMutation({
    mutationFn: () => deleteGmailConfig(),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['gmail-config'] })
  });
  const authorize = useMutation({
    mutationFn: () => getGmailOAuthAuthorizeUrl(),
    onSuccess: (data) => {
      // 認証URLを新しいウィンドウで開く
      window.open(data.authorizationUrl, '_blank', 'width=600,height=700');
    }
  });
  const refresh = useMutation({
    mutationFn: () => refreshGmailToken(),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['gmail-config'] })
  });
  return { update, remove, authorize, refresh };
}
