import { useCallback, useState } from 'react';

type StoredFlagValues = { on: string; off: string };

export function useStoredFlag(key: string, defaultValue: boolean, values: StoredFlagValues = { on: 'on', off: 'off' }) {
  const [enabled, setEnabled] = useState(() => {
    try {
      const stored = localStorage.getItem(key);
      if (stored === values.on) return true;
      if (stored === values.off) return false;
    } catch { /* Fall back to the default when local storage is unavailable. */ }
    return defaultValue;
  });
  const toggle = useCallback(() => {
    const next = !enabled;
    setEnabled(next);
    try { localStorage.setItem(key, next ? values.on : values.off); }
    catch { /* The screen remains usable when local storage is unavailable. */ }
  }, [enabled, key, values.on, values.off]);
  return [enabled, toggle] as const;
}
