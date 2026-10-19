import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { POLL_MS } from '../../lib/admin-polling-intervals';
import {
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
  getSignageEmergency,
  setSignageEmergency,
  getSignageContent,
  getSignageWebCaptures,
  createSignageWebCapture,
  updateSignageWebCapture,
  deleteSignageWebCapture,
  captureSignageWebCaptureNow,
  getSignageManagementOverview,
  type SignageWebCaptureInput,
  type SignageSchedule,
  type SignagePdf
} from '../client';
import { signageQueryKeys } from '../queryKeys/signage';

export function useSignageSchedules() {
  return useQuery({
    queryKey: signageQueryKeys.schedulesAll,
    queryFn: getSignageSchedules
  });
}

export function useSignageSchedulesForManagement() {
  return useQuery({
    queryKey: signageQueryKeys.schedulesManagementAll,
    queryFn: getSignageSchedulesForManagement
  });
}

export function useSignageScheduleMutations() {
  const queryClient = useQueryClient();
  const invalidateSchedules = () => {
    void queryClient.invalidateQueries({ queryKey: signageQueryKeys.schedulesAll });
    void queryClient.invalidateQueries({ queryKey: signageQueryKeys.schedulesManagementAll });
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
    queryKey: signageQueryKeys.pdfsAll,
    queryFn: getSignagePdfs
  });
}

export function useSignagePdfMutations() {
  const queryClient = useQueryClient();
  const upload = useMutation({
    mutationFn: uploadSignagePdf,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: signageQueryKeys.pdfsAll })
  });
  const update = useMutation({
    mutationFn: ({ id, payload }: { id: string; payload: Partial<SignagePdf> }) => updateSignagePdf(id, payload),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: signageQueryKeys.pdfsAll })
  });
  const remove = useMutation({
    mutationFn: (id: string) => deleteSignagePdf(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: signageQueryKeys.pdfsAll })
  });
  return { upload, update, remove };
}

export function useSignageEmergency() {
  return useQuery({
    queryKey: signageQueryKeys.emergencyAll,
    queryFn: getSignageEmergency
  });
}

export function useSignageEmergencyMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: setSignageEmergency,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: signageQueryKeys.emergencyAll })
  });
}

export function useSignageContent() {
  return useQuery({
    queryKey: signageQueryKeys.contentAll,
    queryFn: getSignageContent,
    refetchInterval: 30_000 // 30秒間隔で更新（サイネージ表示用）
  });
}

export function useSignageRenderStatus() {
  return useQuery({
    queryKey: signageQueryKeys.renderStatusAll,
    queryFn: getSignageRenderStatus,
    refetchInterval: POLL_MS.signageRenderStatus // 表示用の進捗確認。負荷との兼ね合いで間隔緩和。
  });
}

export function useSignageRenderMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: renderSignage,
    onSuccess: () => {
      // レンダリング成功後、ステータスを更新
      queryClient.invalidateQueries({ queryKey: signageQueryKeys.renderStatusAll });
    }
  });
}

export function useSignageWebCaptures() {
  return useQuery({
    queryKey: signageQueryKeys.webCapturesAll,
    queryFn: getSignageWebCaptures,
    refetchInterval: 60_000
  });
}

export function useSignageWebCaptureMutations() {
  const queryClient = useQueryClient();
  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: signageQueryKeys.webCapturesAll });
  };
  const create = useMutation({ mutationFn: createSignageWebCapture, onSuccess: invalidate });
  const update = useMutation({
    mutationFn: ({ id, payload }: { id: string; payload: Partial<SignageWebCaptureInput> }) =>
      updateSignageWebCapture(id, payload),
    onSuccess: invalidate
  });
  const remove = useMutation({ mutationFn: (id: string) => deleteSignageWebCapture(id), onSuccess: invalidate });
  const captureNow = useMutation({ mutationFn: (id: string) => captureSignageWebCaptureNow(id), onSuccess: invalidate });
  return { create, update, remove, captureNow };
}

export function useSignageManagementOverview() {
  return useQuery({
    queryKey: signageQueryKeys.managementOverviewAll,
    queryFn: getSignageManagementOverview,
    refetchInterval: 15_000
  });
}
