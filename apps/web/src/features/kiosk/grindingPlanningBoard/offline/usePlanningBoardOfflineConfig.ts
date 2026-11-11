import { useEffect, useMemo, useState } from 'react';

import { getMobilePlacementClientCapabilities, getResolvedClientKey } from '../../../../api/client';

import { DEFAULT_PLANNING_BOARD_OFFLINE_CONFIG } from './planningBoardOfflineConfig';

const storageKey = (clientKey: string | null | undefined) => `kiosk.planning-board.offline-enabled:${clientKey ?? ''}`;

// The last server answer is kept per terminal so the page starts in the right mode
// (no remount when the answer arrives) and still freezes when opened while offline.
function readCached(clientKey: string | null | undefined) {
  try {
    return window.localStorage.getItem(storageKey(clientKey)) === 'true';
  } catch {
    return false;
  }
}

function writeCached(clientKey: string | null | undefined, enabled: boolean) {
  try {
    window.localStorage.setItem(storageKey(clientKey), String(enabled));
  } catch {
    // Storage can be unavailable; the server answer still applies to this page.
  }
}

export function usePlanningBoardOfflineConfig() {
  const [offlineEnabled, setOfflineEnabled] = useState(() => readCached(getResolvedClientKey()));
  useEffect(() => {
    let cancelled = false;
    const clientKey = getResolvedClientKey();
    void getMobilePlacementClientCapabilities().then((capabilities) => {
      if (!cancelled && clientKey === getResolvedClientKey()) {
        const enabled = capabilities.planningBoardOfflineEnabled === true;
        writeCached(clientKey, enabled);
        setOfflineEnabled(enabled);
      }
    }).catch(() => undefined);
    return () => { cancelled = true; };
  }, []);
  return useMemo(() => ({ ...DEFAULT_PLANNING_BOARD_OFFLINE_CONFIG, enabled: offlineEnabled }), [offlineEnabled]);
}
