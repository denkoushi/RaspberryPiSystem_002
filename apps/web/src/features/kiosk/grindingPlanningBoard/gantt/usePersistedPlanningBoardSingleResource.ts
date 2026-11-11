import { useCallback, useMemo, useState } from 'react';

import { planningBoardResourceAvailable } from '../planningBoardTwoMachine';

function readResource(key: string): string | null {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(key) ?? 'null');
    if (value && typeof value === 'object' && 'schemaVersion' in value && value.schemaVersion === 1 &&
      'resourceCd' in value && typeof value.resourceCd === 'string') return value.resourceCd;
  } catch { /* Browser storage is optional. */ }
  return null;
}

export function usePersistedPlanningBoardSingleResource(scope: string, resources: readonly string[]) {
  const key = `kiosk.planning-board.single-resource:${scope}`;
  const [saved, setSaved] = useState(() => ({ key, resourceCd: readResource(key) }));
  const stored = useMemo(() => saved.key === key ? saved.resourceCd : readResource(key), [key, saved]);
  const resourceCd = stored && planningBoardResourceAvailable(stored, resources) ? stored : null;
  const changeResource = useCallback((next: string | null) => {
    setSaved({ key, resourceCd: next });
    try {
      if (next === null) localStorage.removeItem(key);
      else localStorage.setItem(key, JSON.stringify({ schemaVersion: 1, resourceCd: next }));
    } catch { /* Keep the current browser session usable. */ }
  }, [key]);
  return { resourceCd, changeResource };
}
