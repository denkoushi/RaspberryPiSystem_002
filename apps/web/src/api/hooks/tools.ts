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
  listPhotoLabelReviews,
  patchPhotoLabelReview,
  postPhotoGallerySeed,
  getPhotoSimilarCandidates,
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
  getTransactions,
  photoBorrow,
  returnLoan,
  updateEmployee,
  updateItem,
  type CancelPayload,
  type PhotoBorrowPayload,
  type PhotoLabelReviewQuality,
  getUnifiedItems,
  type UnifiedListParams
} from '../client';
import { toolsQueryKeys } from '../queryKeys/tools';

import type {
  BorrowPayload,
  Employee,
  Item,
  ReturnPayload
} from '../types';

export function useDepartments() {
  return useQuery({
    queryKey: toolsQueryKeys.departmentsAll,
    queryFn: getDepartments
  });
}

export function useEmployees() {
  return useQuery({
    queryKey: toolsQueryKeys.employeesAll,
    queryFn: getEmployees
  });
}

export function useMachines(params?: { search?: string; operatingStatus?: string }) {
  return useQuery({
    queryKey: toolsQueryKeys.machines(params),
    queryFn: () => getMachines(params),
  });
}

export function useUninspectedMachines(params?: { csvDashboardId?: string; date?: string }, options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: toolsQueryKeys.uninspectedMachines(params),
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
    onSuccess: () => queryClient.invalidateQueries({ queryKey: toolsQueryKeys.machinesAll })
  });
  const update = useMutation({
    mutationFn: ({ id, payload }: { id: string; payload: UpdateMachineInput }) => updateMachine(id, payload),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: toolsQueryKeys.machinesAll })
  });
  const remove = useMutation({
    mutationFn: (id: string) => deleteMachine(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: toolsQueryKeys.machinesAll })
  });
  return { create, update, remove };
}

export function useEmployeeMutations() {
  const queryClient = useQueryClient();
  const create = useMutation({
    mutationFn: (payload: Partial<Employee>) => createEmployee(payload),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: toolsQueryKeys.employeesAll })
  });
  const update = useMutation({
    mutationFn: ({ id, payload }: { id: string; payload: Partial<Employee> }) => updateEmployee(id, payload),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: toolsQueryKeys.employeesAll })
  });
  const remove = useMutation({
    mutationFn: (id: string) => deleteEmployee(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: toolsQueryKeys.employeesAll })
  });
  return { create, update, remove };
}

export function useItems() {
  return useQuery({
    queryKey: toolsQueryKeys.itemsAll,
    queryFn: getItems
  });
}

export function useItemMutations() {
  const queryClient = useQueryClient();
  const create = useMutation({
    mutationFn: (payload: Partial<Item>) => createItem(payload),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: toolsQueryKeys.itemsAll })
  });
  const update = useMutation({
    mutationFn: ({ id, payload }: { id: string; payload: Partial<Item> }) => updateItem(id, payload),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: toolsQueryKeys.itemsAll })
  });
  const remove = useMutation({
    mutationFn: (id: string) => deleteItem(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: toolsQueryKeys.itemsAll })
  });
  return { create, update, remove };
}

export function useActiveLoans(clientId?: string, clientKey?: string, options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: toolsQueryKeys.loans(clientId, clientKey),
    queryFn: () => getActiveLoans(clientId, clientKey),
    refetchInterval: 30000, // 30秒ごとに自動更新（12時間経過の状態をリアルタイムで反映）
    placeholderData: (previousData) => previousData,
    enabled: options?.enabled !== false // デフォルトはtrue、明示的にfalseが指定された場合のみ無効化
  });
}

export function usePhotoLabelReviews(limit = 50) {
  return useQuery({
    queryKey: toolsQueryKeys.photoLabelReviews(limit),
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
      queryClient.invalidateQueries({ queryKey: toolsQueryKeys.photoLabelReviewsAll });
      queryClient.invalidateQueries({ queryKey: toolsQueryKeys.loansAll });
      queryClient.invalidateQueries({ queryKey: toolsQueryKeys.photoSimilarCandidates(args.loanId) });
    },
  });
}

export function usePostPhotoGallerySeed() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (args: { image: File; canonicalLabel: string }) => postPhotoGallerySeed(args),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: toolsQueryKeys.photoLabelReviewsAll });
      queryClient.invalidateQueries({ queryKey: toolsQueryKeys.loansAll });
      queryClient.invalidateQueries({ queryKey: toolsQueryKeys.photoSimilarCandidates(data.loanId) });
    },
  });
}

export function usePhotoSimilarCandidates(loanId: string, options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: toolsQueryKeys.photoSimilarCandidates(loanId),
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
      queryClient.invalidateQueries({ queryKey: toolsQueryKeys.loansAll });
    }
  });
}

export function useReturnMutation(clientKey?: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (payload: ReturnPayload) => returnLoan(payload, clientKey),
    onSuccess: () => {
      // 返却成功後、すべてのloansクエリを無効化して最新データを取得
      queryClient.invalidateQueries({ queryKey: toolsQueryKeys.loansAll });
    }
  });
}

export function useDeleteLoanMutation(clientKey?: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (loanId: string) => deleteLoan(loanId, clientKey),
    onSuccess: () => {
      // 削除成功後、すべてのloansクエリを無効化して最新データを取得
      queryClient.invalidateQueries({ queryKey: toolsQueryKeys.loansAll });
    }
  });
}

export function useCancelLoanMutation(clientKey?: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (payload: CancelPayload) => cancelLoan(payload, clientKey),
    onSuccess: () => {
      // 取消成功後、すべてのloansクエリを無効化して最新データを取得
      queryClient.invalidateQueries({ queryKey: toolsQueryKeys.loansAll });
    }
  });
}

export function usePhotoBorrowMutation(clientKey?: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (payload: PhotoBorrowPayload) => photoBorrow(payload, clientKey),
    onSuccess: () => {
      // 写真撮影持出成功後、すべてのloansクエリを無効化して最新データを取得
      queryClient.invalidateQueries({ queryKey: toolsQueryKeys.loansAll });
    }
  });
}

export function useTransactions(
  page: number,
  filters?: { startDate?: string; endDate?: string; employeeId?: string; itemId?: string; clientId?: string }
) {
  return useQuery({
    queryKey: toolsQueryKeys.transactions(page, filters),
    queryFn: () => getTransactions(page, filters),
    placeholderData: (previousData) => previousData
  });
}

// 計測機器

export function useUnifiedItems(params?: UnifiedListParams) {
  return useQuery({
    queryKey: toolsQueryKeys.unifiedItems(params),
    queryFn: () => getUnifiedItems(params),
    placeholderData: (previous) => previous
  });
}

// 吊具
