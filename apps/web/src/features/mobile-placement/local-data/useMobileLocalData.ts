import { useEffect, useState } from 'react';

import { useCanSync } from '../sync/networkGate';
import { subscribeSync } from '../sync/syncScheduler';

import { mobileLocalDataStore } from './mobileLocalDataStore';

import type { MobileDataVersions } from '@raspi-system/slip-match-core';

export function useMobileLocalData(kind: 'purchase' | 'verify') {
  const online = useCanSync();
  const [versions, setVersions] = useState<Partial<MobileDataVersions>>({});
  useEffect(() => {
    let alive = true;
    const refresh = async () => {
      try { const current = await mobileLocalDataStore.versions(); if (alive) setVersions(current); } catch { /* Server fallback remains available. */ }
    };
    const unsubscribe = subscribeSync(() => { void refresh(); });
    void refresh();
    return () => { alive = false; unsubscribe(); };
  }, []);
  const dates = kind === 'purchase' ? [versions.purchase?.dataUpdatedAt] : [versions.purchase?.dataUpdatedAt, versions.schedule?.dataUpdatedAt];
  const updatedAt = dates.every(Boolean) ? dates.filter((v): v is string => !!v).sort()[0] : undefined;
  return { offline: !online, updatedAt };
}
