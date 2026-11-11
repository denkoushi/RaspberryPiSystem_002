import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import {
  LEADER_BOARD_CAPACITY_MODE_SCHEMA_VERSION,
  persistedLeaderBoardCapacityModeStorageKey,
  type PersistedLeaderBoardCapacityMode
} from './constants';
import {
  GANTT_DEFAULT_CAPACITY_MINUTES,
  GANTT_EIGHT_HOURS_MINUTES,
  GANTT_TEN_HOURS_MINUTES
} from './gantt/leaderBoardGanttConstants';
import { readLeaderBoardLocalStorage, writeLeaderBoardLocalStorage } from './leaderBoardLocalStorage';

export type LeaderBoardCapacityModeMinutes =
  | typeof GANTT_EIGHT_HOURS_MINUTES
  | typeof GANTT_TEN_HOURS_MINUTES;

function normalizeCapacityModeMinutes(raw: unknown): LeaderBoardCapacityModeMinutes {
  return raw === GANTT_TEN_HOURS_MINUTES ? GANTT_TEN_HOURS_MINUTES : GANTT_EIGHT_HOURS_MINUTES;
}

function normalizeCapacityMinutesBySlotIndex(raw: unknown, slotCount: number): LeaderBoardCapacityModeMinutes[] {
  const clampedCount = Math.max(0, Math.floor(slotCount));
  const arr = Array.isArray(raw) ? raw : [];
  return Array.from({ length: clampedCount }, (_, index) => normalizeCapacityModeMinutes(arr[index]));
}

function loadPersistedCapacityMode(storageKey: string, slotCount: number): LeaderBoardCapacityModeMinutes[] | null {
  if (typeof window === 'undefined') {
    return null;
  }
  const raw = readLeaderBoardLocalStorage(storageKey);
  if (!raw?.trim()) {
    return null;
  }
  try {
    const parsed = JSON.parse(raw) as Partial<PersistedLeaderBoardCapacityMode> | null;
    if (!parsed || parsed.schemaVersion !== LEADER_BOARD_CAPACITY_MODE_SCHEMA_VERSION) {
      return null;
    }
    return normalizeCapacityMinutesBySlotIndex(parsed.capacityMinutesBySlotIndex, slotCount);
  } catch {
    return null;
  }
}

function persistCapacityMode(
  storageKey: string,
  capacityMinutesBySlotIndex: readonly LeaderBoardCapacityModeMinutes[]
): boolean {
  if (typeof window === 'undefined') return false;
  const body: PersistedLeaderBoardCapacityMode = {
    schemaVersion: LEADER_BOARD_CAPACITY_MODE_SCHEMA_VERSION,
    capacityMinutesBySlotIndex: [...capacityMinutesBySlotIndex]
  };
  return writeLeaderBoardLocalStorage(storageKey, JSON.stringify(body));
}

/**
 * スロットごとのガント基準時間（8H/10H）。端末ローカルのみ。
 */
export function usePersistedLeaderBoardCapacityMode(
  siteKey: string,
  deviceScopeKey: string,
  slotCount: number
) {
  const storageKey = useMemo(
    () => persistedLeaderBoardCapacityModeStorageKey(siteKey, deviceScopeKey),
    [siteKey, deviceScopeKey]
  );

  const [capacityMinutesBySlotIndex, setCapacityMinutesBySlotIndex] = useState<
    LeaderBoardCapacityModeMinutes[]
  >(() => normalizeCapacityMinutesBySlotIndex([], slotCount));
  const [hydrated, setHydrated] = useState<{ storageKey: string; slotCount: number } | null>(null);
  const lastWriteSucceeded = useRef(true);

  useEffect(() => {
    if (hydrated?.storageKey === storageKey && hydrated.slotCount === slotCount) return;
    const sameScope = hydrated?.storageKey === storageKey;
    // A write failure belongs to the scope it happened in; a new scope starts from its own storage.
    if (!sameScope) lastWriteSucceeded.current = true;
    // A failed write leaves stale storage behind; retain the current selection in that case.
    const stored = sameScope && !lastWriteSucceeded.current ? null : loadPersistedCapacityMode(storageKey, slotCount);
    setCapacityMinutesBySlotIndex((prev) => stored ?? normalizeCapacityMinutesBySlotIndex(sameScope ? prev : [], slotCount));
    setHydrated({ storageKey, slotCount });
  }, [hydrated, storageKey, slotCount]);

  useEffect(() => {
    // Do not overwrite storage with the old array while the slot count is being restored.
    if (hydrated?.storageKey !== storageKey || hydrated.slotCount !== slotCount) return;
    lastWriteSucceeded.current = persistCapacityMode(storageKey, capacityMinutesBySlotIndex);
  }, [capacityMinutesBySlotIndex, hydrated, slotCount, storageKey]);

  const toggleCapacityForSlot = useCallback((slotIndex: number) => {
    setCapacityMinutesBySlotIndex((prev) => {
      if (slotIndex < 0 || slotIndex >= prev.length) return prev;
      const next = [...prev];
      next[slotIndex] =
        normalizeCapacityModeMinutes(next[slotIndex]) === GANTT_TEN_HOURS_MINUTES
          ? GANTT_EIGHT_HOURS_MINUTES
          : GANTT_TEN_HOURS_MINUTES;
      return next;
    });
  }, []);

  const capacityMinutesForSlot = useCallback(
    (slotIndex: number) =>
      normalizeCapacityModeMinutes(capacityMinutesBySlotIndex[slotIndex] ?? GANTT_DEFAULT_CAPACITY_MINUTES),
    [capacityMinutesBySlotIndex]
  );

  return {
    capacityMinutesBySlotIndex,
    toggleCapacityForSlot,
    capacityMinutesForSlot
  } as const;
}
