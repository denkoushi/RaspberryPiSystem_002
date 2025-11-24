import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  borrowItem,
  createEmployee,
  createItem,
  deleteEmployee,
  deleteItem,
  getActiveLoans,
  getEmployees,
  getImportJobs,
  getItems,
  getKioskConfig,
  getTransactions,
  importMaster,
  returnLoan,
  updateEmployee,
  updateItem
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
  return useMutation({
    mutationFn: (payload: BorrowPayload) => borrowItem(payload, clientKey)
  });
}

export function useReturnMutation(clientKey?: string) {
  return useMutation({
    mutationFn: (payload: ReturnPayload) => returnLoan(payload, clientKey)
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
    queryFn: getKioskConfig
  });
}

export function useImportJobs() {
  return useQuery({
    queryKey: ['import-jobs'],
    queryFn: getImportJobs,
    refetchInterval: 30_000
  });
}

export function useImportMaster() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: importMaster,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['import-jobs'] });
    }
  });
}
