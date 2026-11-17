import { useCallback, useEffect, useMemo, useState } from 'react';

export const FILL_HEIGHT_MIN_INNER_HEIGHT = 1600;
export const FILL_HEIGHT_STORAGE_KEY = 'kiosk-planning-board-fill-height';
const CHANGE_EVENT = 'planning-board-fill-height-change';

function loadEnabled(): boolean {
  try {
    const saved = JSON.parse(window.localStorage.getItem(FILL_HEIGHT_STORAGE_KEY) ?? 'null');
    if (saved?.schemaVersion === 1 && typeof saved.enabled === 'boolean') return saved.enabled;
  } catch {
    // A kiosk may prohibit local storage.
  }
  return false;
}

// The toolbar and chart live under separate page branches; share this device preference without extra DOM.
export function usePersistedPlanningBoardFillHeight(grinding: boolean) {
  const [enabled, setEnabled] = useState(loadEnabled);
  const [tallScreen, setTallScreen] = useState(() => window.innerHeight >= FILL_HEIGHT_MIN_INNER_HEIGHT);
  useEffect(() => {
    const resize = () => setTallScreen(window.innerHeight >= FILL_HEIGHT_MIN_INNER_HEIGHT);
    const change = (event: Event) => setEnabled((event as CustomEvent<boolean>).detail);
    const storage = (event: StorageEvent) => { if (event.key === FILL_HEIGHT_STORAGE_KEY || event.key === null) setEnabled(loadEnabled()); };
    window.addEventListener('resize', resize);
    window.addEventListener(CHANGE_EVENT, change);
    window.addEventListener('storage', storage);
    return () => {
      window.removeEventListener('resize', resize);
      window.removeEventListener(CHANGE_EVENT, change);
      window.removeEventListener('storage', storage);
    };
  }, []);
  const changeFillHeight = useCallback((next: boolean) => {
    setEnabled(next);
    try {
      window.localStorage.setItem(FILL_HEIGHT_STORAGE_KEY, JSON.stringify({ schemaVersion: 1, enabled: next }));
    } catch {
      // Keep the selection for this session even when storage is unavailable.
    }
    window.dispatchEvent(new CustomEvent(CHANGE_EVENT, { detail: next }));
  }, []);
  return { available: grinding && tallScreen, fillHeight: grinding && tallScreen && enabled, changeFillHeight };
}

type FillRowGroup = { category?: string | null; rows: readonly unknown[] };

// Rows share the visible gantt height equally; the key changes whenever row geometry must be re-measured.
export function usePlanningBoardFillRowHeight(eligible: boolean, viewportHeight: number | null, groups: readonly FillRowGroup[],
  singleGroup: boolean, bottomInset: number, chipsByPart: unknown, placementByPart: unknown) {
  const { fillHeight } = usePersistedPlanningBoardFillHeight(eligible);
  const [viewportClientHeight, setViewportClientHeight] = useState(0);
  const fillRowHeight = useMemo(() => {
    if (!fillHeight || !viewportHeight) return undefined;
    const count = groups.reduce((sum, group) => sum + group.rows.length, 0);
    const categoryHeight = singleGroup ? 0 : groups.reduce((sum, group, index) =>
      sum + (group.category && group.category !== groups[index - 1]?.category ? 24 : 0), 0);
    return count ? Math.floor(Math.max(0, (viewportClientHeight || viewportHeight) - (singleGroup ? 0 : 36) - categoryHeight - bottomInset) / count) : undefined;
  }, [fillHeight, viewportHeight, viewportClientHeight, groups, singleGroup, bottomInset]);
  const rowGeometryKey = useMemo(() => fillRowHeight === undefined ? undefined : { fillRowHeight, chipsByPart, placementByPart },
    [fillRowHeight, chipsByPart, placementByPart]);
  return { fillRowHeight, rowGeometryKey, setViewportClientHeight };
}
