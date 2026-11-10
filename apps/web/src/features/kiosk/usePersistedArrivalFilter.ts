import { useCallback, useEffect, useState } from 'react';

function loadMode(storageKey: string): boolean {
  try {
    const saved = JSON.parse(window.localStorage.getItem(storageKey) ?? 'null');
    return saved?.schemaVersion === 1 ? saved.enabled !== false : true;
  } catch {
    return true;
  }
}

/** Arrival preferences belong to this terminal, independently for each board. */
export function usePersistedArrivalFilter(storageKey: string) {
  const [state, setState] = useState(() => ({ key: storageKey, enabled: loadMode(storageKey) }));
  useEffect(() => {
    setState((current) => current.key === storageKey ? current : { key: storageKey, enabled: loadMode(storageKey) });
  }, [storageKey]);
  const arrivalFilterEnabled = state.key === storageKey ? state.enabled : loadMode(storageKey);
  const toggleArrivalFilter = useCallback(() => {
    setState((current) => {
      const enabled = !(current.key === storageKey ? current.enabled : loadMode(storageKey));
      try {
        window.localStorage.setItem(storageKey, JSON.stringify({ schemaVersion: 1, enabled }));
      } catch {
        // Retain the selection for this session when storage is unavailable.
      }
      return { key: storageKey, enabled };
    });
  }, [storageKey]);
  return { arrivalFilterEnabled, toggleArrivalFilter };
}
