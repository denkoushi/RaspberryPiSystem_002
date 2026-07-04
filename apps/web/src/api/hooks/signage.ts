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
  type SignageSchedule,
  type SignagePdf
} from '../client';

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
    void queryClient.invalidateQueries({ queryKey: ['signage-schedules', 'management'] });
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
    refetchInterval: POLL_MS.signageRenderStatus // 表示用の進捗確認。負荷との兼ね合いで間隔緩和。
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
