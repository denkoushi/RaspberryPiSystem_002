import { useEffect, useMemo, useState } from 'react';

import { getMobilePlacementClientCapabilities, getResolvedClientKey } from '../../../../api/client';

import { DEFAULT_PLANNING_BOARD_OFFLINE_CONFIG } from './planningBoardOfflineConfig';

export function usePlanningBoardOfflineConfig() {
  const [offlineEnabled, setOfflineEnabled] = useState(false);
  useEffect(() => {
    let cancelled = false;
    const clientKey = getResolvedClientKey();
    void getMobilePlacementClientCapabilities().then((capabilities) => {
      if (!cancelled && clientKey === getResolvedClientKey()) {
        setOfflineEnabled(capabilities.planningBoardOfflineEnabled === true);
      }
    }).catch(() => undefined);
    return () => { cancelled = true; };
  }, []);
  return useMemo(() => ({ ...DEFAULT_PLANNING_BOARD_OFFLINE_CONFIG, enabled: offlineEnabled }), [offlineEnabled]);
}
