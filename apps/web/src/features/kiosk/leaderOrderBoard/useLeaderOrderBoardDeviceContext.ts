import { useMemo, useState } from 'react';

import {
  useKioskProductionScheduleManualOrderResourceAssignments,
  useKioskProductionScheduleManualOrderSiteDevices
} from '../../../api/hooks';
import { stripSitePrefixFromDeviceLabel } from '../manualOrder/manualOrderDeviceDisplayLabel';

import { LEADER_BOARD_DEVICE_SNAPSHOT_REFETCH_MS } from './performance/leaderBoardRefetchPolicy';

const MANUAL_ORDER_PAGE_SITE_KEY = 'manual-order-page-site';
const DEFAULT_SITES = ['第2工場', 'トークプラザ', '第1工場'] as const;

export type LeaderOrderBoardDeviceCard = {
  deviceScopeKey: string;
  label: string;
  resources: { resourceCd: string }[];
};

/**
 * 順位ボード専用: 端末一覧と資源割当のみ取得（manual-order-overview の重い集約を避ける）。
 */
export function useLeaderOrderBoardDeviceContext() {
  const [siteKey, setSiteKey] = useState<string>(() => {
    if (typeof window === 'undefined') return DEFAULT_SITES[0];
    const stored = window.localStorage.getItem(MANUAL_ORDER_PAGE_SITE_KEY)?.trim();
    return stored && stored.length > 0 ? stored : DEFAULT_SITES[0];
  });

  const siteEnabled = Boolean(siteKey.trim());

  const siteDevicesQuery = useKioskProductionScheduleManualOrderSiteDevices(siteKey, {
    enabled: siteEnabled,
    refetchIntervalMs: LEADER_BOARD_DEVICE_SNAPSHOT_REFETCH_MS
  });

  const resourceAssignmentsQuery = useKioskProductionScheduleManualOrderResourceAssignments(siteKey, {
    enabled: siteEnabled,
    refetchIntervalMs: LEADER_BOARD_DEVICE_SNAPSHOT_REFETCH_MS
  });

  const deviceCards = useMemo<LeaderOrderBoardDeviceCard[]>(() => {
    const keys = siteDevicesQuery.data?.deviceScopeKeys ?? [];
    const byDevice = new Map<string, string[]>();
    for (const row of resourceAssignmentsQuery.data?.assignments ?? []) {
      const dk = row.deviceScopeKey?.trim() ?? '';
      if (!dk.length) continue;
      byDevice.set(
        dk,
        row.resourceCds.map((cd) => cd.trim()).filter((c) => c.length > 0)
      );
    }
    return keys.map((key) => {
      const cds = byDevice.get(key) ?? [];
      return {
        deviceScopeKey: key,
        label: stripSitePrefixFromDeviceLabel(siteKey, key),
        resources: cds.map((resourceCd) => ({ resourceCd }))
      };
    });
  }, [resourceAssignmentsQuery.data?.assignments, siteDevicesQuery.data?.deviceScopeKeys, siteKey]);

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
    handleSiteChange,
    siteDevicesQuery,
    resourceAssignmentsQuery
  };
}
