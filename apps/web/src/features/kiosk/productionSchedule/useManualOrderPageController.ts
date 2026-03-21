import { useMemo, useState } from 'react';

import {
  useKioskProductionScheduleDueManagementManualOrderOverview,
  useKioskProductionScheduleManualOrderSiteDevices
} from '../../../api/hooks';
import { stripSitePrefixFromDeviceLabel } from '../manualOrder/manualOrderDeviceDisplayLabel';

import type { ProductionScheduleDueManagementManualOrderOverviewResource } from '../../../api/client';

const MANUAL_ORDER_PAGE_SITE_KEY = 'manual-order-page-site';
const DEFAULT_SITES = ['第2工場', 'トークプラザ', '第1工場'] as const;

export type ManualOrderOverviewDeviceCard = {
  deviceScopeKey: string;
  label: string;
  resources: ProductionScheduleDueManagementManualOrderOverviewResource[];
};

export function useManualOrderPageController() {
  const [siteKey, setSiteKey] = useState<string>(() => {
    if (typeof window === 'undefined') return DEFAULT_SITES[0];
    const stored = window.localStorage.getItem(MANUAL_ORDER_PAGE_SITE_KEY)?.trim();
    return stored && stored.length > 0 ? stored : DEFAULT_SITES[0];
  });

  const siteDevicesQuery = useKioskProductionScheduleManualOrderSiteDevices(siteKey, { enabled: true });
  const overviewQuery = useKioskProductionScheduleDueManagementManualOrderOverview(
    { siteKey, rankingScope: 'globalShared' },
    { enabled: Boolean(siteKey.trim()) }
  );

  const overviewByDevice = useMemo(() => {
    const map = new Map<string, ManualOrderOverviewDeviceCard>();
    const overview = overviewQuery.data;
    if (overview && 'devices' in overview) {
      overview.devices.forEach((device) => {
        const rawLabel = device.label?.trim() || device.deviceScopeKey;
        map.set(device.deviceScopeKey, {
          deviceScopeKey: device.deviceScopeKey,
          label: stripSitePrefixFromDeviceLabel(siteKey, rawLabel),
          resources: device.resources
        });
      });
    }
    return map;
  }, [overviewQuery.data, siteKey]);

  const deviceCards = useMemo<ManualOrderOverviewDeviceCard[]>(() => {
    const keys = siteDevicesQuery.data?.deviceScopeKeys ?? [];
    return keys.map((key) => {
      const matched = overviewByDevice.get(key);
      if (matched) return matched;
      return {
        deviceScopeKey: key,
        label: key,
        resources: []
      };
    });
  }, [overviewByDevice, siteDevicesQuery.data?.deviceScopeKeys]);

  const handleSiteChange = (next: string) => {
    setSiteKey(next);
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(MANUAL_ORDER_PAGE_SITE_KEY, next);
    }
  };

  return {
    siteKey,
    defaultSites: DEFAULT_SITES,
    deviceCards,
    siteDevicesQuery,
    overviewQuery,
    handleSiteChange
  };
}
