import { useCallback, useEffect, useState } from 'react';

export const PIECE_LINKS_STORAGE_KEY = 'kiosk-planning-board-piece-links';
const CHANGE_EVENT = 'planning-board-piece-links-change';

function loadEnabled() {
  try {
    const saved = JSON.parse(window.localStorage.getItem(PIECE_LINKS_STORAGE_KEY) ?? 'null');
    if (saved?.schemaVersion === 1 && typeof saved.enabled === 'boolean') return saved.enabled;
  } catch { /* Storage is optional on kiosks. */ }
  return true;
}

export function usePersistedPlanningBoardPieceLinks() {
  const [pieceLinks, setPieceLinks] = useState(loadEnabled);
  useEffect(() => {
    const change = (event: Event) => setPieceLinks((event as CustomEvent<boolean>).detail);
    const storage = (event: StorageEvent) => {
      if (event.key === PIECE_LINKS_STORAGE_KEY || event.key === null) setPieceLinks(loadEnabled());
    };
    window.addEventListener(CHANGE_EVENT, change);
    window.addEventListener('storage', storage);
    return () => {
      window.removeEventListener(CHANGE_EVENT, change);
      window.removeEventListener('storage', storage);
    };
  }, []);
  const changePieceLinks = useCallback((enabled: boolean) => {
    try {
      window.localStorage.setItem(PIECE_LINKS_STORAGE_KEY, JSON.stringify({ schemaVersion: 1, enabled }));
    } catch { /* The setting still applies to this session. */ }
    window.dispatchEvent(new CustomEvent(CHANGE_EVENT, { detail: enabled }));
  }, []);
  return { pieceLinks, changePieceLinks };
}
