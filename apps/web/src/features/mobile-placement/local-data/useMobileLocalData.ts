import { useEffect, useState } from 'react';

import { canUseMobileNetwork, useMobileConnectivity } from '../connectivity';

import { mobileLocalDataStore } from './mobileLocalDataStore';
import { syncMobileLocalData } from './mobileLocalDataSync';

import type { MobileDataVersions } from '@raspi-system/slip-match-core';

export function useMobileLocalData(kind: 'purchase' | 'verify') {
  const online = useMobileConnectivity();
  const [versions, setVersions] = useState<Partial<MobileDataVersions>>({});
  useEffect(() => {
    let alive = true;
    const refresh = async () => {
      try { const current = await mobileLocalDataStore.versions(); if (alive) setVersions(current); } catch { /* Server fallback remains available. */ }
    };
    const sync = async () => {
      await refresh();
      if (!canUseMobileNetwork()) return;
      try { await syncMobileLocalData(); await refresh(); } catch { /* Keep the previous snapshot and try again on reconnect/timer. */ }
    };
    const onOnline = () => { void sync(); };
    window.addEventListener('online', onOnline);
    const timer = window.setInterval(() => { void sync(); }, 30 * 60 * 1000);
    void sync();
    return () => {
      alive = false; window.clearInterval(timer);
      window.removeEventListener('online', onOnline);
    };
  }, [online]);
  const dates = kind === 'purchase' ? [versions.purchase?.dataUpdatedAt] : [versions.purchase?.dataUpdatedAt, versions.schedule?.dataUpdatedAt];
  const updatedAt = dates.every(Boolean) ? dates.filter((v): v is string => !!v).sort()[0] : undefined;
  return { offline: !online, updatedAt };
}
