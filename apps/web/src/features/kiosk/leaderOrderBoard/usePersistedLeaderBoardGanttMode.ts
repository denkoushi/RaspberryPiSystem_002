import { useCallback, useEffect, useMemo, useState } from 'react';

import {
  LEADER_BOARD_GANTT_MODE_SCHEMA_VERSION,
  persistedLeaderBoardGanttModeStorageKey,
  type PersistedLeaderBoardGanttMode
} from './constants';

function loadPersistedGanttMode(storageKey: string): boolean {
  if (typeof window === 'undefined') return false;
  const raw = window.localStorage.getItem(storageKey);
  if (!raw?.trim()) return false;
  try {
    const parsed = JSON.parse(raw) as Partial<PersistedLeaderBoardGanttMode> | null;
    if (!parsed || parsed.schemaVersion !== LEADER_BOARD_GANTT_MODE_SCHEMA_VERSION) {
      return false;
    }
    return Boolean(parsed.enabled);
  } catch {
    return false;
  }
}

function persistGanttMode(storageKey: string, enabled: boolean): void {
  if (typeof window === 'undefined') return;
  const body: PersistedLeaderBoardGanttMode = {
    schemaVersion: LEADER_BOARD_GANTT_MODE_SCHEMA_VERSION,
    enabled
  };
  window.localStorage.setItem(storageKey, JSON.stringify(body));
}

function readGanttModeSnapshot(storageKey: string): boolean {
  return loadPersistedGanttMode(storageKey);
}

/**
 * ガント表示 ON/OFF。端末ローカルのみ（共有 search-state とは独立）。
 */
export function usePersistedLeaderBoardGanttMode(siteKey: string, deviceScopeKey: string) {
  const storageKey = useMemo(
    () => persistedLeaderBoardGanttModeStorageKey(siteKey, deviceScopeKey),
    [siteKey, deviceScopeKey]
  );

  const [enabled, setEnabled] = useState(false);
  const [hydratedStorageKey, setHydratedStorageKey] = useState<string | null>(null);

  useEffect(() => {
    setEnabled(loadPersistedGanttMode(storageKey));
    setHydratedStorageKey(storageKey);
  }, [storageKey]);

  useEffect(() => {
    if (hydratedStorageKey !== storageKey) return;
    if (readGanttModeSnapshot(storageKey) === enabled) return;
    persistGanttMode(storageKey, enabled);
  }, [hydratedStorageKey, storageKey, enabled]);

  const toggleGanttMode = useCallback(() => {
    setEnabled((prev) => !prev);
  }, []);

  return {
    ganttEnabled: enabled,
    setGanttEnabled: setEnabled,
    toggleGanttMode
  };
}
