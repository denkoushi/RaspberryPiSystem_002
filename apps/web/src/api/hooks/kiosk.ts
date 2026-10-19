import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import {
  getKioskInquirySummary,
  listKioskInquiries,
  openKioskInquiry,
  replyToKioskInquiry,
  getKioskInquiryReceiverSettings,
  updateKioskInquiryReceiverSettings,
  lookupKioskInquiryEmployee,
  getKioskConfig,
  putKioskInitialRoute,
  putKioskPortalCards,
  getKioskNavTabOrderSettings,
  updateKioskNavTabOrderSettings,
  getKioskEmployees,
  getKioskCallTargets
} from '../client';
import { kioskQueryKeys } from '../queryKeys/kiosk';

import type { KioskConfig, KioskInquiryDetail, KioskInquirySummary, KioskInquiryThread } from '../domains/kiosk';
import type { KioskInitialRouteId, KioskReorderableHeaderTabId } from '@raspi-system/shared-types';

export function useKioskEmployees(clientKey?: string) {
  return useQuery({
    queryKey: kioskQueryKeys.employees(clientKey),
    queryFn: () => getKioskEmployees(clientKey),
    enabled: !!clientKey
  });
}

export function useKioskNavTabOrderSettings() {
  return useQuery({
    queryKey: kioskQueryKeys.navTabOrderSettingsAll,
    queryFn: getKioskNavTabOrderSettings
  });
}

export function useUpdateKioskNavTabOrderSettings() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (payload: { tabOrder: string[] }) => updateKioskNavTabOrderSettings(payload),
    onSuccess: (data) => {
      queryClient.setQueryData(kioskQueryKeys.navTabOrderSettingsAll, data);
      void queryClient.invalidateQueries({ queryKey: kioskQueryKeys.navTabOrderSettingsAll });
      void queryClient.invalidateQueries({ queryKey: kioskQueryKeys.configAll });
    }
  });
}

export function useUpdateKioskInitialRoute(clientKey: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (initialRoute: KioskInitialRouteId | null) =>
      putKioskInitialRoute(initialRoute, clientKey),
    onMutate: async () => {
      await queryClient.cancelQueries({ queryKey: kioskQueryKeys.configAll });
    },
    onSuccess: (data) => {
      queryClient.setQueryData<KioskConfig>(kioskQueryKeys.configAll, (current) =>
        current ? { ...current, initialKioskRoute: data.initialKioskRoute, initialKioskPath: data.initialKioskPath } : current
      );
      void queryClient.invalidateQueries({ queryKey: kioskQueryKeys.configAll });
    }
  });
}

export function useUpdateKioskPortalCards(clientKey: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (hiddenTabIds: KioskReorderableHeaderTabId[]) => putKioskPortalCards(hiddenTabIds, clientKey),
    onMutate: async () => {
      await queryClient.cancelQueries({ queryKey: kioskQueryKeys.configAll });
    },
    onSuccess: (data) => {
      queryClient.setQueryData<KioskConfig>(kioskQueryKeys.configAll, (current) =>
        current ? { ...current, portalHiddenTabIds: data.portalHiddenTabIds } : current
      );
      void queryClient.invalidateQueries({ queryKey: kioskQueryKeys.configAll });
    }
  });
}

export function useKioskConfig() {
  return useQuery({
    queryKey: kioskQueryKeys.configAll,
    queryFn: getKioskConfig,
    staleTime: 0, // キャッシュを無効化して常に最新データを取得（設定変更時に即座に反映されるように）
    refetchInterval: 60000, // 60秒ごとにポーリング（温度表示用、Pi3/Pi4のリソースを浪費しない）
    refetchOnWindowFocus: true // ウィンドウフォーカス時にリフェッチ（設定変更時に即座に反映されるように）
  });
}

export function useKioskCallTargets() {
  return useQuery({
    queryKey: kioskQueryKeys.callTargetsAll,
    queryFn: getKioskCallTargets,
    refetchInterval: 60_000
  });
}

export function useKioskInquirySummary(clientKey: string | undefined, enabled: boolean) {
  return useQuery({
    queryKey: kioskQueryKeys.inquirySummary(clientKey),
    queryFn: ({ signal }) => getKioskInquirySummary(signal),
    enabled: enabled && !!clientKey,
    refetchInterval: 30000
  });
}

// The credential stays in a session-owned ref, never in query keys or mutation variables.
export type KioskInquiryAccess = { employeeTagUid?: string; signal?: AbortSignal; active: boolean };

export function useKioskInquiries(clientKey: string, sessionId: string, access: KioskInquiryAccess, enabled: boolean) {
  return useQuery({
    queryKey: kioskQueryKeys.inquiries(clientKey, sessionId),
    queryFn: ({ signal }) => listKioskInquiries(access.employeeTagUid, signal),
    enabled,
    retry: false,
    refetchInterval: 30000
  });
}

export function useKioskInquiryActions(clientKey: string, sessionId: string, access: KioskInquiryAccess) {
  const queryClient = useQueryClient();
  const onSuccess = (data: KioskInquiryDetail) => {
    if (!access.active) return;
    const listKey = kioskQueryKeys.inquiries(clientKey, sessionId);
    const previous = queryClient.getQueryData<{ threads: KioskInquiryThread[] }>(listKey);
    const wasUnread = previous?.threads.find(thread => thread.id === data.thread.id)?.unread;
    queryClient.setQueryData(listKey, previous ? {
      threads: [data.thread, ...previous.threads.filter(thread => thread.id !== data.thread.id)]
        .sort((a, b) => b.lastMessageAt.localeCompare(a.lastMessageAt))
    } : { threads: [data.thread] });
    const summaryKey = kioskQueryKeys.inquirySummary(clientKey);
    queryClient.setQueryData<KioskInquirySummary>(summaryKey, current => current && wasUnread && !data.thread.unread
      ? { ...current, unreadCount: Math.max(0, current.unreadCount - 1) } : current);
    void queryClient.invalidateQueries({ queryKey: summaryKey });
    void queryClient.invalidateQueries({ queryKey: listKey });
  };
  const open = useMutation({
    mutationFn: (threadId: string) => openKioskInquiry(threadId, access.employeeTagUid, access.signal),
    onSuccess
  });
  const reply = useMutation({
    mutationFn: ({ threadId, body }: { threadId: string; body: string }) =>
      replyToKioskInquiry(threadId, body, access.employeeTagUid, access.signal),
    onSuccess
  });
  return { open, reply };
}

export function useKioskInquiryReceiverSettings() {
  return useQuery({ queryKey: kioskQueryKeys.inquiryReceiverSettingsAll, queryFn: getKioskInquiryReceiverSettings });
}

export function useUpdateKioskInquiryReceiverSettings() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (payload: { receiverClientDeviceIds: string[]; systemNoticeReceiverClientDeviceIds: string[]; employeeCodes: string[] }) => updateKioskInquiryReceiverSettings(payload),
    onSuccess: data => {
      queryClient.setQueryData(kioskQueryKeys.inquiryReceiverSettingsAll, data);
      void queryClient.invalidateQueries({ queryKey: kioskQueryKeys.inquiryReceiverSettingsAll });
      void queryClient.invalidateQueries({ queryKey: kioskQueryKeys.inquirySummaryAll });
    }
  });
}

export function useLookupKioskInquiryEmployee() {
  return useMutation({ mutationFn: (employeeCode: string) => lookupKioskInquiryEmployee(employeeCode) });
}
