import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  borrowItem,
  createEmployee,
  createItem,
  deleteEmployee,
  deleteItem,
  deleteLoan,
  getActiveLoans,
  getClients,
  getEmployees,
  getItems,
  getKioskConfig,
  getTransactions,
  importMaster,
  photoBorrow,
  returnLoan,
  updateClient,
  updateEmployee,
  updateItem,
  type ClientDevice,
  type PhotoBorrowPayload
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
    refetchInterval: 2_000, // 2秒ごとに更新（キオスク画面の要件）
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
    refetchInterval: false, // ポーリングを無効化（設定は頻繁に変わらないため）
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
