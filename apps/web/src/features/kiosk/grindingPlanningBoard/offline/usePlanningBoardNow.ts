import { useEffect, useMemo, useState } from 'react';

import { useFrozenValue, usePlanningBoardOffline } from './PlanningBoardOfflineProvider';

/** Sample the server clock on the 30-second tick and connectivity changes, not on every UI render. */
export function usePlanningBoardNow(): number {
  const offline = usePlanningBoardOffline();
  const [liveNowMs, setNowMs] = useState(() => Date.now());
  // `offline` is a new object whenever its now(), frozen state or snapshot changes.
  const sampledNowMs = useMemo(() => offline.enabled ? offline.now() : liveNowMs, [offline, liveNowMs]);
  useEffect(() => {
    const interval = window.setInterval(() => setNowMs(Date.now()), 30_000);
    return () => window.clearInterval(interval);
  }, []);
  return useFrozenValue(sampledNowMs);
}
