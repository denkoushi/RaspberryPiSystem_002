import { useState } from 'react';

const STORAGE_KEY = 'kiosk-portal-large-screen';

export function useKioskPortalLargeScreen() {
  const [largeScreen, setLargeScreen] = useState(() => {
    try { return localStorage.getItem(STORAGE_KEY) === 'true'; } catch { return false; }
  });
  const toggleLargeScreen = () => {
    const next = !largeScreen;
    setLargeScreen(next);
    try { localStorage.setItem(STORAGE_KEY, String(next)); } catch { /* Keep the in-memory preference. */ }
  };
  return { largeScreen, toggleLargeScreen };
}
