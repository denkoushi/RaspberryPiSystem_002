import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  borrowItem,
  createEmployee,
  createItem,
  getActiveLoans,
  getEmployees,
  getItems,
  getKioskConfig,
  getTransactions,
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
  return { create, update };
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
  return { create, update };
}

export function useActiveLoans(clientId?: string, clientKey?: string) {
  return useQuery({
    queryKey: ['loans', clientId, clientKey],
    queryFn: () => getActiveLoans(clientId, clientKey),
    refetchInterval: 10_000
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

export function useTransactions(page: number) {
  return useQuery({
    queryKey: ['transactions', page],
    queryFn: () => getTransactions(page),
    placeholderData: (previousData) => previousData
  });
}

export function useKioskConfig() {
  return useQuery({
    queryKey: ['kiosk-config'],
    queryFn: getKioskConfig
  });
}
