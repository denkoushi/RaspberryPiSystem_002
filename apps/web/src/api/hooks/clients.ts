import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo } from 'react';

import { mobilePlacementQueryKeys } from '../../features/mobile-placement/mobilePlacementQueryKeys';
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
import { clientsQueryKeys } from '../queryKeys/clients';
import { kioskQueryKeys } from '../queryKeys/kiosk';

export function useClients() {
  return useQuery({
    queryKey: clientsQueryKeys.clientsAll,
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
      queryClient.invalidateQueries({ queryKey: clientsQueryKeys.clientsAll });
      queryClient.invalidateQueries({ queryKey: kioskQueryKeys.configAll });
      queryClient.invalidateQueries({ queryKey: mobilePlacementQueryKeys.haizenTargetDevices });
    }
  });
  return { update };
}

export function useSites() {
  return useQuery({
    queryKey: clientsQueryKeys.sitesAll,
    queryFn: getSites
  });
}

export function useCreateSite() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: createSite,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: clientsQueryKeys.sitesAll });
    }
  });
}

/** キオスクの拠点選択肢（管理画面で登録した拠点） */
export function useKioskSites(options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: clientsQueryKeys.kioskSitesAll,
    queryFn: getKioskSites,
    staleTime: 5 * 60_000,
    // 開いたままの画面にも、管理画面で追加した拠点を反映する（アプリ全体で focus 時の再取得は無効）。
    refetchInterval: 5 * 60_000,
    enabled: options?.enabled ?? true
  });
}

export function useClientStatuses() {
  return useQuery({
    queryKey: clientsQueryKeys.statusAll,
    queryFn: getClientStatuses,
    refetchInterval: 60_000
  });
}

export function useClientLogs(filters: { clientId?: string; level?: ClientLogLevel; limit?: number; since?: string }) {
  return useQuery({
    queryKey: clientsQueryKeys.logs(filters),
    queryFn: () => getClientLogs(filters)
  });
}

export function useClientAlerts() {
  return useQuery({
    queryKey: clientsQueryKeys.alertsAll,
    queryFn: getClientAlerts,
    refetchInterval: 60_000 // 1分ごとに更新
  });
}

export function useAcknowledgeAlert() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: acknowledgeAlert,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: clientsQueryKeys.alertsAll });
    }
  });
}
