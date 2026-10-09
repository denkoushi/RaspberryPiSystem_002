import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import {
  getKioskConfig,
  putKioskInitialRoute,
  getKioskNavTabOrderSettings,
  updateKioskNavTabOrderSettings,
  getKioskEmployees,
  getKioskCallTargets
} from '../client';

import type { KioskConfig } from '../domains/kiosk';
import type { KioskInitialRouteId } from '@raspi-system/shared-types';

export function useKioskEmployees(clientKey?: string) {
  return useQuery({
    queryKey: ['kiosk-employees', clientKey],
    queryFn: () => getKioskEmployees(clientKey),
    enabled: !!clientKey
  });
}

export function useKioskNavTabOrderSettings() {
  return useQuery({
    queryKey: ['kiosk-nav-tab-order-settings'],
    queryFn: getKioskNavTabOrderSettings
  });
}

export function useUpdateKioskNavTabOrderSettings() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (payload: { tabOrder: string[] }) => updateKioskNavTabOrderSettings(payload),
    onSuccess: (data) => {
      queryClient.setQueryData(['kiosk-nav-tab-order-settings'], data);
      void queryClient.invalidateQueries({ queryKey: ['kiosk-nav-tab-order-settings'] });
      void queryClient.invalidateQueries({ queryKey: ['kiosk-config'] });
    }
  });
}

export function useUpdateKioskInitialRoute(clientKey: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (initialRoute: KioskInitialRouteId | null) =>
      putKioskInitialRoute(initialRoute, clientKey),
    onMutate: async () => {
      await queryClient.cancelQueries({ queryKey: ['kiosk-config'] });
    },
    onSuccess: (data) => {
      queryClient.setQueryData<KioskConfig>(['kiosk-config'], (current) =>
        current ? { ...current, initialKioskRoute: data.initialKioskRoute, initialKioskPath: data.initialKioskPath } : current
      );
      void queryClient.invalidateQueries({ queryKey: ['kiosk-config'] });
    }
  });
}

export function useKioskConfig() {
  return useQuery({
    queryKey: ['kiosk-config'],
    queryFn: getKioskConfig,
    staleTime: 0, // キャッシュを無効化して常に最新データを取得（設定変更時に即座に反映されるように）
    refetchInterval: 60000, // 60秒ごとにポーリング（温度表示用、Pi3/Pi4のリソースを浪費しない）
    refetchOnWindowFocus: true // ウィンドウフォーカス時にリフェッチ（設定変更時に即座に反映されるように）
  });
}

export function useKioskCallTargets() {
  return useQuery({
    queryKey: ['kiosk-call-targets'],
    queryFn: getKioskCallTargets,
    refetchInterval: 60_000
  });
}
