import { useCallback, useEffect, useMemo, useState } from 'react';

import {
  LEADER_BOARD_LABOR_MODE_SCHEMA_VERSION,
  persistedLeaderBoardLaborModeStorageKey,
  type PersistedLeaderBoardLaborMode
} from './constants';

function normalizeEnabledBySlotIndex(raw: unknown, slotCount: number): boolean[] {
  const clampedCount = Math.max(0, Math.floor(slotCount));
  const arr = Array.isArray(raw) ? raw : [];
  return Array.from({ length: clampedCount }, (_, index) => Boolean(arr[index]));
}

function loadPersistedLaborMode(storageKey: string, slotCount: number): boolean[] {
  if (typeof window === 'undefined') {
    return normalizeEnabledBySlotIndex([], slotCount);
  }
  const raw = window.localStorage.getItem(storageKey);
  if (!raw?.trim()) {
    return normalizeEnabledBySlotIndex([], slotCount);
  }
  try {
    const parsed = JSON.parse(raw) as Partial<PersistedLeaderBoardLaborMode> | null;
    if (!parsed || parsed.schemaVersion !== LEADER_BOARD_LABOR_MODE_SCHEMA_VERSION) {
      return normalizeEnabledBySlotIndex([], slotCount);
    }
    return normalizeEnabledBySlotIndex(parsed.enabledBySlotIndex, slotCount);
  } catch {
    return normalizeEnabledBySlotIndex([], slotCount);
  }
}

function persistLaborMode(storageKey: string, enabledBySlotIndex: readonly boolean[]): void {
  if (typeof window === 'undefined') return;
  const body: PersistedLeaderBoardLaborMode = {
    schemaVersion: LEADER_BOARD_LABOR_MODE_SCHEMA_VERSION,
    enabledBySlotIndex: [...enabledBySlotIndex]
  };
  window.localStorage.setItem(storageKey, JSON.stringify(body));
}

/**
 * スロットごとの `+人` ON/OFF。端末ローカルのみ。
 */
export function usePersistedLeaderBoardLaborMode(
  siteKey: string,
  deviceScopeKey: string,
  slotCount: number
) {
  const storageKey = useMemo(
    () => persistedLeaderBoardLaborModeStorageKey(siteKey, deviceScopeKey),
    [siteKey, deviceScopeKey]
  );

  const [enabledBySlotIndex, setEnabledBySlotIndex] = useState<boolean[]>(() =>
    normalizeEnabledBySlotIndex([], slotCount)
  );
  const [hydratedStorageKey, setHydratedStorageKey] = useState<string | null>(null);

  useEffect(() => {
    setEnabledBySlotIndex(loadPersistedLaborMode(storageKey, slotCount));
    setHydratedStorageKey(storageKey);
  }, [storageKey, slotCount]);

  useEffect(() => {
    if (hydratedStorageKey !== storageKey) return;
    setEnabledBySlotIndex((prev) => {
      if (prev.length === slotCount) return prev;
      const next = normalizeEnabledBySlotIndex(prev, slotCount);
      return next;
    });
  }, [hydratedStorageKey, slotCount, storageKey]);

  useEffect(() => {
    if (hydratedStorageKey !== storageKey) return;
    persistLaborMode(storageKey, enabledBySlotIndex);
  }, [enabledBySlotIndex, hydratedStorageKey, storageKey]);

  const toggleLaborForSlot = useCallback((slotIndex: number) => {
    setEnabledBySlotIndex((prev) => {
      if (slotIndex < 0 || slotIndex >= prev.length) return prev;
      const next = [...prev];
      next[slotIndex] = !next[slotIndex];
      return next;
    });
  }, []);

  const isLaborEnabledForSlot = useCallback(
    (slotIndex: number) => Boolean(enabledBySlotIndex[slotIndex]),
    [enabledBySlotIndex]
  );

  return {
    laborEnabledBySlotIndex: enabledBySlotIndex,
    toggleLaborForSlot,
    isLaborEnabledForSlot
  } as const;
}
