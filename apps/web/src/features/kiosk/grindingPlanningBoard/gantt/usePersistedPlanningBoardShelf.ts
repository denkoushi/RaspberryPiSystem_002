import { useCallback, useState } from 'react';

export const SEIBAN_SHELF_STORAGE_KEY = 'kiosk-planning-board-seiban-shelf';

function loadOpen(): boolean {
  try {
    const saved = JSON.parse(window.localStorage.getItem(SEIBAN_SHELF_STORAGE_KEY) ?? 'null');
    if (saved?.schemaVersion === 1 && typeof saved.open === 'boolean') return saved.open;
  } catch { /* Device storage is optional. */ }
  return true;
}

export function usePersistedPlanningBoardShelf() {
  const [open, setOpen] = useState(loadOpen);
  const changeOpen = useCallback((open: boolean) => {
    setOpen(open);
    try {
      window.localStorage.setItem(SEIBAN_SHELF_STORAGE_KEY, JSON.stringify({ schemaVersion: 1, open }));
    } catch { /* Keep the session usable when storage is unavailable. */ }
  }, []);
  return { open, changeOpen };
}
