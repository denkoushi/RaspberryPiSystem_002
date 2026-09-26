import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo } from 'react';

import { buildClientDevicesByApiKey } from '../../lib/signageTargetClientDevices';
import {
  getClients,
  getClientLogs,
  getClientStatuses,
  getClientAlerts,
  getKioskSites,
  acknowledgeAlert,
  createSite,
  getSites,
  updateClient,
  type ClientLogLevel
} from '../client';

export function useClients() {
  return useQuery({
    queryKey: ['clients'],
    queryFn: getClients
  });
}

/** サイネージスケジュール編集: 端末一覧 + apiKey インデックス（一覧要約用） */

export function useSignageScheduleEditorClients() {
  const query = useClients();
  const clientsByApiKey = useMemo(
    () => buildClientDevicesByApiKey(query.data ?? []),
    [query.data]
  );
  return { ...query, clientsByApiKey };
}

export function useClientMutations() {
  const queryClient = useQueryClient();
  const update = useMutation({
    mutationFn: ({
      id,
      payload
    }: {
      id: string;
      payload: {
        name?: string;
        defaultMode?: 'PHOTO' | 'TAG' | null;
        kioskInitialRoute?: string | null;
        haizenEdgeEnabled?: boolean;
        shelfLayoutEditEnabled?: boolean;
        siteKey?: string | null;
        canProxyOtherDevices?: boolean;
      };
    }) => updateClient(id, payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['clients'] });
      queryClient.invalidateQueries({ queryKey: ['kiosk-config'] });
      queryClient.invalidateQueries({ queryKey: ['mobile-placement', 'haizen-target-devices'] });
    }
  });
  return { update };
}

export function useSites() {
  return useQuery({
    queryKey: ['sites'],
    queryFn: getSites
  });
}

export function useCreateSite() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: createSite,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['sites'] });
    }
  });
}

/** キオスクの拠点選択肢（管理画面で登録した拠点） */
export function useKioskSites(options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: ['kiosk-sites'],
    queryFn: getKioskSites,
    staleTime: 5 * 60_000,
    enabled: options?.enabled ?? true
  });
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
