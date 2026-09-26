import { useEffect, useMemo, useState } from 'react';

import { useKioskProductionScheduleManualOrderSiteDevices } from '../../../api/hooks';
import { readProductionBuildConfig } from '../../../config/productionBuildConfig';
import { isMacEnvironment } from '../../../lib/client-key/resolver';
import { KIOSK_DEFAULT_SITE_KEY } from '../sites/useKioskSiteKeys';

const MANUAL_ORDER_DEVICE_SCOPE_V2_ENABLED =
  readProductionBuildConfig().manualOrderDeviceScopeV2Enabled;

export const PRODUCTION_SCHEDULE_MAC_TARGET_SITE_KEY = 'production-schedule-mac-target-site';
export const PRODUCTION_SCHEDULE_MAC_TARGET_DEVICE_KEY = 'production-schedule-mac-target-device';

export function useProductionScheduleMacDeviceScope() {
  const isMac =
    typeof window !== 'undefined' ? isMacEnvironment(window.navigator.userAgent) : false;
  const macManualOrderV2 = isMac && MANUAL_ORDER_DEVICE_SCOPE_V2_ENABLED;

  const [macTargetSite, setMacTargetSite] = useState<string>(() => {
    if (typeof window === 'undefined') return KIOSK_DEFAULT_SITE_KEY;
    const stored = window.localStorage.getItem(PRODUCTION_SCHEDULE_MAC_TARGET_SITE_KEY)?.trim();
    return stored && stored.length > 0 ? stored : KIOSK_DEFAULT_SITE_KEY;
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
