import { useCallback, useEffect, useMemo, useState } from 'react';

import { persistedLeaderBoardScawModeStorageKey } from './constants';

type PersistedLeaderBoardScawMode = { schemaVersion: 1; enabled: boolean };

function loadPersistedScawMode(storageKey: string): boolean {
  if (typeof window === 'undefined') return false;
  try {
    const raw = window.localStorage.getItem(storageKey);
    if (!raw?.trim()) return false;
    const parsed = JSON.parse(raw) as Partial<PersistedLeaderBoardScawMode> | null;
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
  const body: PersistedLeaderBoardScawMode = {
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
export function usePersistedLeaderBoardScawMode(siteKey: string, deviceScopeKey: string) {
  const storageKey = useMemo(
    () => persistedLeaderBoardScawModeStorageKey(siteKey, deviceScopeKey),
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
