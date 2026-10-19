import { useCallback, useLayoutEffect, useState } from 'react';

export const PLANNING_BOARD_LARGE_SCREEN_ZOOM = 0.7;
export const LARGE_SCREEN_STORAGE_KEY = 'kiosk-planning-board-large-screen';

function loadEnabled(): boolean {
  try {
    const saved = JSON.parse(window.localStorage.getItem(LARGE_SCREEN_STORAGE_KEY) ?? 'null');
    if (saved?.schemaVersion === 1 && typeof saved.enabled === 'boolean') return saved.enabled;
  } catch {
    // A kiosk may prohibit local storage.
  }
  return false;
}

export function usePlanningBoardLargeScreen() {
  const [largeScreen, setLargeScreen] = useState(loadEnabled);
  const changeLargeScreen = useCallback((enabled: boolean) => {
    setLargeScreen(enabled);
    try {
      window.localStorage.setItem(LARGE_SCREEN_STORAGE_KEY, JSON.stringify({ schemaVersion: 1, enabled }));
    } catch {
      // Keep the selection for this session even when storage is unavailable.
    }
  }, []);
  useLayoutEffect(() => {
    document.documentElement.style.zoom = largeScreen ? String(PLANNING_BOARD_LARGE_SCREEN_ZOOM) : '';
    // CSS zoom need not emit a window resize; remeasure the board and close anchored popovers.
    window.dispatchEvent(new Event('resize'));
    return () => { document.documentElement.style.zoom = ''; };
  }, [largeScreen]);
  return { largeScreen, changeLargeScreen };
}
