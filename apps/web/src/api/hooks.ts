import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  borrowItem,
  cancelLoan,
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
  getEmployees,
  getItems,
  getKioskConfig,
  getSystemInfo,
  getTransactions,
  importMaster,
  photoBorrow,
  returnLoan,
  updateClient,
  updateEmployee,
  updateItem,
  type CancelPayload,
  type ClientDevice,
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
  type SignageSchedule,
  type SignagePdf,
  type ClientLogLevel
} from './client';
import type { BorrowPayload, Employee, Item, ReturnPayload } from './types';

export function useEmployees() {
  return useQuery({
    queryKey: ['employees'],
    queryFn: getEmployees
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
    refetchInterval: false, // 自動更新を無効化（手動操作で即座に反映されるため不要）
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

export function useKioskConfig() {
  return useQuery({
    queryKey: ['kiosk-config'],
    queryFn: getKioskConfig,
    staleTime: 0, // キャッシュを無効化して常に最新データを取得（設定変更時に即座に反映されるように）
    refetchInterval: 5000, // 5秒ごとにポーリング（設定変更時に即座に反映されるように）
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
