import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef } from 'react';

import { autoUnitSplitKioskSessakuPieces } from '../../../api/domains/production-schedule/grinding-planning-board';
import { productionScheduleQueryKeys } from '../../../api/queryKeys/productionSchedule';

/** Bounded background work, with no overlapping requests or user-facing failures. */
export function usePlanningBoardAutoUnitSplit(isBusy?: () => boolean) {
  const queryClient = useQueryClient();
  // Defer while the user is saving pieces or completions so their expected versions stay valid.
  const isBusyRef = useRef(isBusy);
  useEffect(() => { isBusyRef.current = isBusy; });
  const attempts = useRef(0);
  const finished = useRef(false);
  const requestPending = useRef(false);
  useEffect(() => {
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    let delay = 3000;
    const schedule = () => {
      if (!stopped && !finished.current && attempts.current < 10) timer = setTimeout(() => { void run(); }, delay);
    };
    const run = async () => {
      if (stopped) return;
      if (requestPending.current || !navigator.onLine || isBusyRef.current?.()) { schedule(); return; }
      attempts.current++;
      requestPending.current = true;
      try {
        const response = await autoUnitSplitKioskSessakuPieces();
        if (stopped) return;
        delay = 3000;
        finished.current = !response.hasMore;
        if (response.splitCount > 0) void queryClient.invalidateQueries({ queryKey: productionScheduleQueryKeys.grindingPlanningBoardAll });
      } catch {
        if (stopped) return;
        delay = Math.min(delay * 2, 30000);
      } finally {
        requestPending.current = false;
      }
      schedule();
    };
    schedule();
    return () => { stopped = true; clearTimeout(timer); };
  }, [queryClient]);
}
