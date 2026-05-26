import { useEffect, useMemo, useState } from 'react';

import { useKioskProductionScheduleManualOrderSiteDevices } from '../../../api/hooks';
import { isMacEnvironment } from '../../../lib/client-key/resolver';

const MANUAL_ORDER_DEVICE_SCOPE_V2_ENABLED =
  import.meta.env.VITE_KIOSK_MANUAL_ORDER_DEVICE_SCOPE_V2_ENABLED !== 'false';

export const PRODUCTION_SCHEDULE_MAC_TARGET_SITE_KEY = 'production-schedule-mac-target-site';
export const PRODUCTION_SCHEDULE_MAC_TARGET_DEVICE_KEY = 'production-schedule-mac-target-device';

export const DEFAULT_MAC_TARGET_SITES = ['第2工場', 'トークプラザ', '第1工場'] as const;

export function useProductionScheduleMacDeviceScope() {
  const isMac =
    typeof window !== 'undefined' ? isMacEnvironment(window.navigator.userAgent) : false;
  const macManualOrderV2 = isMac && MANUAL_ORDER_DEVICE_SCOPE_V2_ENABLED;

  const [macTargetSite, setMacTargetSite] = useState<string>(() => {
    if (typeof window === 'undefined') return DEFAULT_MAC_TARGET_SITES[0];
    const stored = window.localStorage.getItem(PRODUCTION_SCHEDULE_MAC_TARGET_SITE_KEY)?.trim();
    return stored && stored.length > 0 ? stored : DEFAULT_MAC_TARGET_SITES[0];
  });
  const [macTargetDevice, setMacTargetDevice] = useState<string>(() => {
    if (typeof window === 'undefined') return '';
    return window.localStorage.getItem(PRODUCTION_SCHEDULE_MAC_TARGET_DEVICE_KEY)?.trim() ?? '';
  });

  const macSiteDevicesQuery = useKioskProductionScheduleManualOrderSiteDevices(
    macManualOrderV2 ? macTargetSite : undefined,
    { enabled: macManualOrderV2 }
  );

  useEffect(() => {
    if (!macManualOrderV2) return;
    const keys = macSiteDevicesQuery.data?.deviceScopeKeys ?? [];
    if (keys.length === 0) return;
    if (!macTargetDevice || !keys.includes(macTargetDevice)) {
      const next = keys[0] ?? '';
      setMacTargetDevice(next);
      if (typeof window !== 'undefined' && next) {
        window.localStorage.setItem(PRODUCTION_SCHEDULE_MAC_TARGET_DEVICE_KEY, next);
      }
    }
  }, [macManualOrderV2, macSiteDevicesQuery.data?.deviceScopeKeys, macTargetDevice]);

  const scopeParams = useMemo(() => {
    if (macManualOrderV2 && macTargetDevice.trim().length > 0) {
      return { targetDeviceScopeKey: macTargetDevice.trim() };
    }
    return {};
  }, [macManualOrderV2, macTargetDevice]);

  const scopeEnabled = !macManualOrderV2 || macTargetDevice.trim().length > 0;

  return {
    macManualOrderV2,
    macTargetSite,
    setMacTargetSite,
    macTargetDevice,
    setMacTargetDevice,
    macSiteDevicesQuery,
    scopeParams,
    scopeEnabled
  };
}
