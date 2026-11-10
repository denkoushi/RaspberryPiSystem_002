import { useCallback, useEffect, useRef, useState } from 'react';

import { useUpdateKioskGrindingPlanningBoardArrival, useUpdateKioskGrindingPlanningBoardFirstProcessArrival } from '../../../api/hooks';
import { usePersistedArrivalFilter } from '../usePersistedArrivalFilter';

import type { GrindingPlanningBoardFirstProcessState, GrindingPlanningBoardItem, GrindingPlanningBoardResponse } from '@raspi-system/shared-types';

export function usePlanningBoardArrival(data: GrindingPlanningBoardResponse | undefined, nowMs: number, dueSource?: 'excel' | 'scaw') {
  const { arrivalFilterEnabled, toggleArrivalFilter } = usePersistedArrivalFilter('kiosk-planning-board-arrival-filter');
  const mutation = useUpdateKioskGrindingPlanningBoardArrival(dueSource);
  const firstProcessMutation = useUpdateKioskGrindingPlanningBoardFirstProcessArrival(dueSource);
  const [firstProcessOverlay, setFirstProcessOverlay] = useState<ReadonlyMap<string, { siteKey: string; state: GrindingPlanningBoardFirstProcessState }>>(new Map());
  const pending = useRef(false);
  const [overlay, setOverlay] = useState<ReadonlyMap<string, { siteKey: string; date: string }>>(new Map());
  const arrivalDate = new Date(nowMs + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const siteKey = data?.siteKey;
  const applyArrival = useCallback((item: GrindingPlanningBoardItem): GrindingPlanningBoardItem => {
    if (item.isFirstProcess) {
      const firstProcess = firstProcessOverlay.get(item.itemId);
      return firstProcess && firstProcess.siteKey === siteKey
        ? { ...item, firstProcessState: firstProcess.state,
          ...(firstProcess.state ? { arrived: firstProcess.state === 'arrived' } : {}) } : item;
    }
    const arrival = overlay.get(item.itemId);
    return arrival && arrival.siteKey === siteKey && arrival.date === arrivalDate
      ? { ...item, arrived: true, manualArrivalDate: arrival.date } : item;
  }, [overlay, firstProcessOverlay, siteKey, arrivalDate]);
  useEffect(() => {
    setOverlay((previous) => {
      const next = new Map([...previous].filter(([id, entry]) => entry.siteKey === data?.siteKey &&
        entry.date === arrivalDate && !data?.items.some((item) => item.itemId === id && item.manualArrivalDate === entry.date)));
      return next.size === previous.size ? previous : next;
    });
  }, [data, arrivalDate]);
  useEffect(() => {
    setFirstProcessOverlay((previous) => {
      // The mutation invalidates the board, so the next response for the item is authoritative.
      const next = new Map([...previous].filter(([id, entry]) => entry.siteKey === data?.siteKey &&
        !data?.items.some((item) => item.itemId === id)));
      return next.size === previous.size ? previous : next;
    });
  }, [data]);
  const changeFirstProcessArrival = async (item: GrindingPlanningBoardItem, state: GrindingPlanningBoardFirstProcessState) => {
    if (pending.current || !siteKey) return;
    pending.current = true;
    try {
      const result = await firstProcessMutation.mutateAsync({ itemId: item.itemId, itemRevision: item.itemRevision,
        overrideVersion: item.version, state });
      setFirstProcessOverlay((previous) => {
        const next = new Map(previous);
        next.set(item.itemId, { siteKey, state: result.firstProcessState });
        return next;
      });
    } catch {
      // The popover displays the mutation error next to the arrival controls.
    } finally { pending.current = false; }
  };
  const changeArrival = async (item: GrindingPlanningBoardItem, recorded: boolean) => {
    if (pending.current || !siteKey) return;
    pending.current = true;
    try {
      const result = await mutation.mutateAsync({ itemId: item.itemId, itemRevision: item.itemRevision,
        overrideVersion: item.version, recorded });
      setOverlay((previous) => {
        const next = new Map(previous);
        if (result.manualArrivalDate) next.set(item.itemId, { siteKey, date: result.manualArrivalDate });
        else next.delete(item.itemId);
        return next;
      });
    } catch {
      // The popover displays the mutation error next to the arrival controls.
    } finally { pending.current = false; }
  };
  return { arrivalFilterEnabled, toggleArrivalFilter, applyArrival, changeArrival, changeFirstProcessArrival,
    arrivalPending: mutation.isPending || firstProcessMutation.isPending, arrivalError: mutation.isError || firstProcessMutation.isError };
}
