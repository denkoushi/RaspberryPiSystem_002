import { useCallback, useEffect, useMemo, useState } from 'react';

export function persistedLoadBalancingScawModeStorageKey(siteKey: string, deviceScopeKey: string): string {
  const s = siteKey.trim();
  const d = deviceScopeKey.trim();
  const core = s.length > 0 && d.length > 0 ? `${s}\0${d}` : s || d;
  const prefix = 'kiosk-load-balancing-scaw-mode';
  return core ? `${prefix}:${core}` : prefix;
}

type PersistedLoadBalancingScawMode = { schemaVersion: 1; enabled: boolean };

function loadPersistedScawMode(storageKey: string): boolean {
  if (typeof window === 'undefined') return false;
  try {
    const raw = window.localStorage.getItem(storageKey);
    if (!raw?.trim()) return false;
    const parsed = JSON.parse(raw) as Partial<PersistedLoadBalancingScawMode> | null;
    if (!parsed || parsed.schemaVersion !== 1) {
      return false;
    }
    return parsed.enabled === true;
  } catch {
    return false;
  }
}

function persistScawMode(storageKey: string, enabled: boolean): void {
  if (typeof window === 'undefined') return;
  const body: PersistedLoadBalancingScawMode = {
    schemaVersion: 1,
    enabled
  };
  try {
    window.localStorage.setItem(storageKey, JSON.stringify(body));
  } catch {
    // Retain the selection for this session when storage is unavailable.
  }
}

function readScawModeSnapshot(storageKey: string): boolean {
  return loadPersistedScawMode(storageKey);
}

/**
 * SCAW 表示 ON/OFF。端末ローカルのみ（共有 search-state とは独立）。
 */
export function usePersistedLoadBalancingScawMode(siteKey: string, deviceScopeKey: string) {
  const storageKey = useMemo(
    () => persistedLoadBalancingScawModeStorageKey(siteKey, deviceScopeKey),
    [siteKey, deviceScopeKey]
  );

  const [enabled, setEnabled] = useState(false);
  const [hydratedStorageKey, setHydratedStorageKey] = useState<string | null>(null);

  useEffect(() => {
    setEnabled(loadPersistedScawMode(storageKey));
    setHydratedStorageKey(storageKey);
  }, [storageKey]);

  useEffect(() => {
    if (hydratedStorageKey !== storageKey) return;
    if (readScawModeSnapshot(storageKey) === enabled) return;
    persistScawMode(storageKey, enabled);
  }, [hydratedStorageKey, storageKey, enabled]);

  const toggleScawMode = useCallback(() => {
    setEnabled((prev) => !prev);
  }, []);

  return {
    scawEnabled: enabled,
    setScawEnabled: setEnabled,
    toggleScawMode
  };
}
