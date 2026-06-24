import { useCallback, useEffect, useMemo, useState } from 'react';

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

function loadPersistedCapacityMode(storageKey: string, slotCount: number): LeaderBoardCapacityModeMinutes[] {
  if (typeof window === 'undefined') {
    return normalizeCapacityMinutesBySlotIndex([], slotCount);
  }
  const raw = window.localStorage.getItem(storageKey);
  if (!raw?.trim()) {
    return normalizeCapacityMinutesBySlotIndex([], slotCount);
  }
  try {
    const parsed = JSON.parse(raw) as Partial<PersistedLeaderBoardCapacityMode> | null;
    if (!parsed || parsed.schemaVersion !== LEADER_BOARD_CAPACITY_MODE_SCHEMA_VERSION) {
      return normalizeCapacityMinutesBySlotIndex([], slotCount);
    }
    return normalizeCapacityMinutesBySlotIndex(parsed.capacityMinutesBySlotIndex, slotCount);
  } catch {
    return normalizeCapacityMinutesBySlotIndex([], slotCount);
  }
}

function persistCapacityMode(
  storageKey: string,
  capacityMinutesBySlotIndex: readonly LeaderBoardCapacityModeMinutes[]
): void {
  if (typeof window === 'undefined') return;
  const body: PersistedLeaderBoardCapacityMode = {
    schemaVersion: LEADER_BOARD_CAPACITY_MODE_SCHEMA_VERSION,
    capacityMinutesBySlotIndex: [...capacityMinutesBySlotIndex]
  };
  window.localStorage.setItem(storageKey, JSON.stringify(body));
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
  const [hydratedStorageKey, setHydratedStorageKey] = useState<string | null>(null);

  useEffect(() => {
    setCapacityMinutesBySlotIndex(loadPersistedCapacityMode(storageKey, slotCount));
    setHydratedStorageKey(storageKey);
  }, [storageKey, slotCount]);

  useEffect(() => {
    if (hydratedStorageKey !== storageKey) return;
    setCapacityMinutesBySlotIndex((prev) => {
      if (prev.length === slotCount) return prev;
      return normalizeCapacityMinutesBySlotIndex(prev, slotCount);
    });
  }, [hydratedStorageKey, slotCount, storageKey]);

  useEffect(() => {
    if (hydratedStorageKey !== storageKey) return;
    persistCapacityMode(storageKey, capacityMinutesBySlotIndex);
  }, [capacityMinutesBySlotIndex, hydratedStorageKey, storageKey]);

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
