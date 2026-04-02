import { useCallback, useEffect, useMemo, useState } from 'react';

import {
  LEADER_BOARD_DEFAULT_SLOT_COUNT,
  LEADER_BOARD_MAX_RESOURCE_SLOTS,
  LEADER_BOARD_MIN_RESOURCE_SLOTS,
  LEADER_BOARD_SLOT_SCHEMA_VERSION,
  leaderBoardSlotStorageKey
} from './constants';

type Persisted = {
  schemaVersion: number;
  slotCount: number;
  resourceCdBySlotIndex: Array<string | null>;
};

const normalizeCd = (v: string | null | undefined): string | null => {
  const t = String(v ?? '').trim();
  return t.length > 0 ? t : null;
};

/** スロット順を保ち、null を除く。同一 CD は先勝ち。 */
export const uniqueOrderedResourceCds = (slots: Array<string | null>): string[] => {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of slots) {
    const cd = normalizeCd(raw);
    if (!cd || seen.has(cd)) continue;
    seen.add(cd);
    out.push(cd);
  }
  return out;
};

function loadPersisted(storageKey: string): Persisted | null {
  if (typeof window === 'undefined') {
    return null;
  }
  const raw = window.localStorage.getItem(storageKey);
  if (!raw) {
    return null;
  }
  try {
    const parsed = JSON.parse(raw) as Partial<Persisted>;
    if (!parsed || parsed.schemaVersion !== LEADER_BOARD_SLOT_SCHEMA_VERSION) {
      return null;
    }
    const rawCount = typeof parsed.slotCount === 'number' ? parsed.slotCount : LEADER_BOARD_DEFAULT_SLOT_COUNT;
    const slotCount = Math.min(
      LEADER_BOARD_MAX_RESOURCE_SLOTS,
      Math.max(LEADER_BOARD_MIN_RESOURCE_SLOTS, rawCount)
    );
    const arr = Array.isArray(parsed.resourceCdBySlotIndex) ? parsed.resourceCdBySlotIndex : [];
    const resourceCdBySlotIndex: Array<string | null> = [];
    for (let i = 0; i < slotCount; i += 1) {
      resourceCdBySlotIndex.push(normalizeCd(arr[i] as string | null | undefined));
    }
    return { schemaVersion: LEADER_BOARD_SLOT_SCHEMA_VERSION, slotCount, resourceCdBySlotIndex };
  } catch {
    return null;
  }
}

function defaultStateFromFallback(fallback: string[]): Persisted {
  const slotCount = Math.min(
    LEADER_BOARD_MAX_RESOURCE_SLOTS,
    Math.max(LEADER_BOARD_MIN_RESOURCE_SLOTS, LEADER_BOARD_DEFAULT_SLOT_COUNT)
  );
  const resourceCdBySlotIndex: Array<string | null> = Array.from({ length: slotCount }, () => null);
  const orderedFallback = uniqueOrderedResourceCds(fallback.map((s) => s));
  orderedFallback.slice(0, slotCount).forEach((cd, i) => {
    resourceCdBySlotIndex[i] = cd;
  });
  return { schemaVersion: LEADER_BOARD_SLOT_SCHEMA_VERSION, slotCount, resourceCdBySlotIndex };
}

export type UseLeaderBoardResourceSlotsOptions = {
  /** localStorage のスコープ（工場・端末など。空ならグローバルキー） */
  scopeKey: string;
  /** 永続が無いときの初期スロット埋め（従来の端末割当資源など） */
  fallbackAssignedResourceCds: string[];
};

export function useLeaderBoardResourceSlots({
  scopeKey,
  fallbackAssignedResourceCds
}: UseLeaderBoardResourceSlotsOptions) {
  const storageKey = useMemo(() => leaderBoardSlotStorageKey(scopeKey), [scopeKey]);
  const fallbackSeed = useMemo(
    () => uniqueOrderedResourceCds(fallbackAssignedResourceCds.map((s) => s)).join('\0'),
    [fallbackAssignedResourceCds]
  );

  const [slotCount, setSlotCountState] = useState(LEADER_BOARD_DEFAULT_SLOT_COUNT);
  const [resourceCdBySlotIndex, setResourceCdBySlotIndex] = useState<Array<string | null>>(() =>
    Array.from({ length: LEADER_BOARD_DEFAULT_SLOT_COUNT }, () => null)
  );
  const [hydratedStorageKey, setHydratedStorageKey] = useState<string | null>(null);

  useEffect(() => {
    const persisted = loadPersisted(storageKey);
    if (persisted) {
      setSlotCountState(persisted.slotCount);
      setResourceCdBySlotIndex(persisted.resourceCdBySlotIndex);
    } else {
      const init = defaultStateFromFallback(fallbackAssignedResourceCds);
      setSlotCountState(init.slotCount);
      setResourceCdBySlotIndex(init.resourceCdBySlotIndex);
    }
    setHydratedStorageKey(storageKey);
  }, [storageKey, fallbackSeed, fallbackAssignedResourceCds]);

  useEffect(() => {
    if (typeof window === 'undefined' || hydratedStorageKey !== storageKey) {
      return;
    }
    const payload: Persisted = {
      schemaVersion: LEADER_BOARD_SLOT_SCHEMA_VERSION,
      slotCount,
      resourceCdBySlotIndex
    };
    window.localStorage.setItem(storageKey, JSON.stringify(payload));
  }, [hydratedStorageKey, resourceCdBySlotIndex, slotCount, storageKey]);

  const activeResourceCds = useMemo(
    () => uniqueOrderedResourceCds(resourceCdBySlotIndex),
    [resourceCdBySlotIndex]
  );

  const setSlotCount = useCallback((next: number) => {
    const clamped = Math.min(
      LEADER_BOARD_MAX_RESOURCE_SLOTS,
      Math.max(LEADER_BOARD_MIN_RESOURCE_SLOTS, Math.floor(next))
    );
    setSlotCountState(clamped);
    setResourceCdBySlotIndex((prev) => {
      if (prev.length === clamped) {
        return prev;
      }
      if (prev.length < clamped) {
        return [...prev, ...Array.from({ length: clamped - prev.length }, () => null)];
      }
      return prev.slice(0, clamped);
    });
  }, []);

  const assignSlotCd = useCallback((slotIndex: number, cd: string | null) => {
    setResourceCdBySlotIndex((prev) => {
      if (slotIndex < 0 || slotIndex >= prev.length) {
        return prev;
      }
      const next = [...prev];
      const normalized = normalizeCd(cd);
      if (normalized) {
        for (let i = 0; i < next.length; i += 1) {
          if (i !== slotIndex && normalizeCd(next[i]) === normalized) {
            next[i] = null;
          }
        }
      }
      next[slotIndex] = normalized;
      return next;
    });
  }, []);

  const clearSlot = useCallback((slotIndex: number) => {
    assignSlotCd(slotIndex, null);
  }, [assignSlotCd]);

  return {
    slotCount,
    setSlotCount,
    resourceCdBySlotIndex,
    assignSlotCd,
    clearSlot,
    activeResourceCds
  } as const;
}
