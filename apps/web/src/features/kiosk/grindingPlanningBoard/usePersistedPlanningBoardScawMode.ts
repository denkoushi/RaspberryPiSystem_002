import { useCallback, useState } from 'react';

export const SCAW_MODE_STORAGE_KEY = 'kiosk-planning-board-scaw-mode';

function loadMode(): boolean {
  try {
    const saved = JSON.parse(window.localStorage.getItem(SCAW_MODE_STORAGE_KEY) ?? 'null');
    return saved?.schemaVersion === 1 && saved.enabled === true;
  } catch {
    return false;
  }
}

export function usePersistedPlanningBoardScawMode() {
  const [scawEnabled, setScawEnabled] = useState(loadMode);
  const toggleScawMode = useCallback(() => {
    setScawEnabled((enabled) => {
      const next = !enabled;
      try {
        window.localStorage.setItem(SCAW_MODE_STORAGE_KEY, JSON.stringify({ schemaVersion: 1, enabled: next }));
      } catch {
        // Retain the selection for this session when storage is unavailable.
      }
      return next;
    });
  }, []);
  return { scawEnabled, toggleScawMode };
}
