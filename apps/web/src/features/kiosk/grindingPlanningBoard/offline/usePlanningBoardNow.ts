import { useEffect, useMemo, useState } from 'react';

import { isForwardDragActive, subscribeForwardDragActivity } from '../gantt/planningBoardForwardDrop';

import { useFrozenValue, usePlanningBoardOffline } from './planningBoardOfflineContext';

/** Sample the server clock on the 30-second tick and connectivity changes, not on every UI render. */
export function usePlanningBoardNow(): number {
  const offline = usePlanningBoardOffline();
  const [liveNowMs, setNowMs] = useState(() => Date.now());
  // `offline` is a new object whenever its now(), frozen state or snapshot changes.
  const sampledNowMs = useMemo(() => offline.enabled ? offline.now() : liveNowMs, [offline, liveNowMs]);
  useEffect(() => {
    // A tick that lands mid-drag is skipped and applied once when the drag ends.
    let missed = false;
    const interval = window.setInterval(() => {
      if (isForwardDragActive()) missed = true; else setNowMs(Date.now());
    }, 30_000);
    const unsubscribe = subscribeForwardDragActivity(() => {
      if (!isForwardDragActive() && missed) { missed = false; setNowMs(Date.now()); }
    });
    return () => { window.clearInterval(interval); unsubscribe(); };
  }, []);
  // Reading the drag state in render would re-render the page at drag start and end; skipping the tick is enough.
  return useFrozenValue(sampledNowMs);
}
