import { useEffect, useState } from 'react';

import { mobileLocalDataStore } from './mobileLocalDataStore';
import { syncMobileLocalData } from './mobileLocalDataSync';

import type { MobileDataVersions } from '@raspi-system/slip-match-core';

export function useMobileLocalData(kind: 'purchase' | 'verify') {
  const [offline, setOffline] = useState(() => typeof navigator !== 'undefined' && !navigator.onLine);
  const [versions, setVersions] = useState<Partial<MobileDataVersions>>({});
  useEffect(() => {
    let alive = true;
    const refresh = async () => {
      try { const current = await mobileLocalDataStore.versions(); if (alive) setVersions(current); } catch { /* Server fallback remains available. */ }
    };
    const sync = async () => {
      await refresh();
      if (!navigator.onLine) return;
      try { await syncMobileLocalData(); await refresh(); } catch { /* Keep the previous snapshot and try again on reconnect/timer. */ }
    };
    const online = () => { setOffline(false); void sync(); };
    const offline = () => setOffline(true);
    window.addEventListener('online', online); window.addEventListener('offline', offline);
    const timer = window.setInterval(() => { void sync(); }, 30 * 60 * 1000);
    void sync();
    return () => {
      alive = false; window.clearInterval(timer);
      window.removeEventListener('online', online); window.removeEventListener('offline', offline);
    };
  }, []);
  const dates = kind === 'purchase' ? [versions.purchase?.dataUpdatedAt] : [versions.purchase?.dataUpdatedAt, versions.schedule?.dataUpdatedAt];
  const updatedAt = dates.every(Boolean) ? dates.filter((v): v is string => !!v).sort()[0] : undefined;
  return { offline, updatedAt };
}
