import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import {
  LEADER_BOARD_LABOR_MODE_SCHEMA_VERSION,
  persistedLeaderBoardLaborModeStorageKey,
  type PersistedLeaderBoardLaborMode
} from './constants';
import { readLeaderBoardLocalStorage, writeLeaderBoardLocalStorage } from './leaderBoardLocalStorage';

function normalizeEnabledBySlotIndex(raw: unknown, slotCount: number): boolean[] {
  const clampedCount = Math.max(0, Math.floor(slotCount));
  const arr = Array.isArray(raw) ? raw : [];
  return Array.from({ length: clampedCount }, (_, index) => Boolean(arr[index]));
}

function loadPersistedLaborMode(storageKey: string, slotCount: number): boolean[] | null {
  if (typeof window === 'undefined') {
    return null;
  }
  const raw = readLeaderBoardLocalStorage(storageKey);
  if (!raw?.trim()) {
    return null;
  }
  try {
    const parsed = JSON.parse(raw) as Partial<PersistedLeaderBoardLaborMode> | null;
    if (!parsed || parsed.schemaVersion !== LEADER_BOARD_LABOR_MODE_SCHEMA_VERSION) {
      return null;
    }
    return normalizeEnabledBySlotIndex(parsed.enabledBySlotIndex, slotCount);
  } catch {
    return null;
  }
}

function persistLaborMode(storageKey: string, enabledBySlotIndex: readonly boolean[]): boolean {
  if (typeof window === 'undefined') return false;
  const body: PersistedLeaderBoardLaborMode = {
    schemaVersion: LEADER_BOARD_LABOR_MODE_SCHEMA_VERSION,
    enabledBySlotIndex: [...enabledBySlotIndex]
  };
  return writeLeaderBoardLocalStorage(storageKey, JSON.stringify(body));
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
  const [hydrated, setHydrated] = useState<{ storageKey: string; slotCount: number } | null>(null);
  const lastWriteSucceeded = useRef(true);

  useEffect(() => {
    if (hydrated?.storageKey === storageKey && hydrated.slotCount === slotCount) return;
    const sameScope = hydrated?.storageKey === storageKey;
    // A write failure belongs to the scope it happened in; a new scope starts from its own storage.
    if (!sameScope) lastWriteSucceeded.current = true;
    // A failed write leaves stale storage behind; retain the current selection in that case.
    const stored = sameScope && !lastWriteSucceeded.current ? null : loadPersistedLaborMode(storageKey, slotCount);
    setEnabledBySlotIndex((prev) => stored ?? normalizeEnabledBySlotIndex(sameScope ? prev : [], slotCount));
    setHydrated({ storageKey, slotCount });
  }, [hydrated, storageKey, slotCount]);

  useEffect(() => {
    // Do not overwrite storage with the old array while the slot count is being restored.
    if (hydrated?.storageKey !== storageKey || hydrated.slotCount !== slotCount) return;
    lastWriteSucceeded.current = persistLaborMode(storageKey, enabledBySlotIndex);
  }, [enabledBySlotIndex, hydrated, slotCount, storageKey]);

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
