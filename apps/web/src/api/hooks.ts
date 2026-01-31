import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import {
  getBackupHistory,
  getBackupHistoryById,
  restoreFromDropbox,
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
  getKioskEmployees,
  getKioskProductionSchedule,
  getKioskProductionScheduleOrderUsage,
  getKioskProductionScheduleResources,
  getKioskProductionScheduleSearchState,
  getKioskProductionScheduleSearchHistory,
  importMasterSingle,
  setKioskProductionScheduleSearchState,
  setKioskProductionScheduleSearchHistory,
  updateKioskProductionScheduleOrder,
  updateKioskProductionScheduleNote
} from './client';
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
  getClients,
  getClientLogs,
  getClientStatuses,
  getClientAlerts,
  acknowledgeAlert,
  getDepartments,
  getEmployees,
  getItems,
  getKioskConfig,
  getKioskCallTargets,
  getSystemInfo,
  getTransactions,
  importMaster,
  photoBorrow,
  returnLoan,
  updateClient,
  updateEmployee,
  updateItem,
  getDeployStatus,
  type CancelPayload,
  type PhotoBorrowPayload,
  getSignageSchedules,
  createSignageSchedule,
  updateSignageSchedule,
  deleteSignageSchedule,
  getSignagePdfs,
  renderSignage,
  getSignageRenderStatus,
  uploadSignagePdf,
  updateSignagePdf,
  deleteSignagePdf,
  getSignageEmergency,
  setSignageEmergency,
  getSignageContent,
  getCsvDashboards,
  getVisualizationDashboards,
  type SignageSchedule,
  type SignagePdf,
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
    resourceCds?: string;
    resourceAssignedOnlyCds?: string;
    hasNoteOnly?: boolean;
    page?: number;
    pageSize?: number;
  },
  options?: { enabled?: boolean }
) {
  return useQuery({
    queryKey: ['kiosk-production-schedule', params],
    queryFn: () => getKioskProductionSchedule(params),
    // 仕掛中が頻繁に変わるため軽く自動更新
    refetchInterval: 30000,
    placeholderData: (previousData) => previousData,
    enabled: options?.enabled ?? true
  });
}

export function useKioskProductionScheduleResources() {
  return useQuery({
    queryKey: ['kiosk-production-schedule-resources'],
    queryFn: getKioskProductionScheduleResources,
    refetchInterval: 60000,
  });
}

export function useKioskProductionScheduleOrderUsage(resourceCds?: string) {
  return useQuery({
    queryKey: ['kiosk-production-schedule-order-usage', resourceCds],
    queryFn: () => getKioskProductionScheduleOrderUsage(resourceCds ? { resourceCds } : undefined),
    refetchInterval: 15000,
  });
}

export function useKioskProductionScheduleSearchState() {
  return useQuery({
    queryKey: ['kiosk-production-schedule-search-state'],
    queryFn: getKioskProductionScheduleSearchState,
    refetchInterval: 4000,
  });
}

export function useKioskProductionScheduleSearchHistory() {
  return useQuery({
    queryKey: ['kiosk-production-schedule-search-history'],
    queryFn: getKioskProductionScheduleSearchHistory,
    refetchInterval: 4000,
  });
}

export function useUpdateKioskProductionScheduleSearchState() {
  return useMutation({
    mutationFn: (state: Parameters<typeof setKioskProductionScheduleSearchState>[0]) =>
      setKioskProductionScheduleSearchState(state),
  });
}

export function useUpdateKioskProductionScheduleSearchHistory() {
  return useMutation({
    mutationFn: (history: Parameters<typeof setKioskProductionScheduleSearchHistory>[0]) =>
      setKioskProductionScheduleSearchHistory(history),
  });
}

export function useUpdateKioskProductionScheduleOrder() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ rowId, payload }: { rowId: string; payload: { resourceCd: string; orderNumber: number | null } }) =>
      updateKioskProductionScheduleOrder(rowId, payload),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['kiosk-production-schedule'] });
      await queryClient.invalidateQueries({ queryKey: ['kiosk-production-schedule-order-usage'] });
    },
  });
}

export function useUpdateKioskProductionScheduleNote() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ rowId, note }: { rowId: string; note: string }) =>
      updateKioskProductionScheduleNote(rowId, { note }),
    onSuccess: async (data, { rowId }) => {
      queryClient.setQueriesData<{
        page: number;
        pageSize: number;
        total: number;
        rows: Array<{ id: string; occurredAt: string | Date; rowData: unknown; processingOrder?: number | null; note?: string | null }>;
      }>({ queryKey: ['kiosk-production-schedule'] }, (oldData) => {
        if (!oldData) return oldData;
        return {
          ...oldData,
          rows: oldData.rows.map((row) =>
            row.id === rowId ? { ...row, note: data.note } : row
          )
        };
      });
      await queryClient.invalidateQueries({ queryKey: ['kiosk-production-schedule'] });
    }
  });
}

export function useCompleteKioskProductionScheduleRow() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (rowId: string) => completeKioskProductionScheduleRow(rowId),
    onSuccess: async (data, rowId) => {
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
      await queryClient.invalidateQueries({ queryKey: ['kiosk-production-schedule'] });
      await queryClient.invalidateQueries({ queryKey: ['kiosk-production-schedule-order-usage'] });
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
    mutationFn: ({ id, payload }: { id: string; payload: { defaultMode?: 'PHOTO' | 'TAG' | null } }) => updateClient(id, payload),
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

export function useSignageScheduleMutations() {
  const queryClient = useQueryClient();
  const create = useMutation({
    mutationFn: createSignageSchedule,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['signage-schedules'] })
  });
  const update = useMutation({
    mutationFn: ({ id, payload }: { id: string; payload: Partial<SignageSchedule> }) => updateSignageSchedule(id, payload),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['signage-schedules'] })
  });
  const remove = useMutation({
    mutationFn: (id: string) => deleteSignageSchedule(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['signage-schedules'] })
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
  return { updateConfig, addTarget, updateTarget, deleteTarget, runBackup: runBackupMutation };
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
