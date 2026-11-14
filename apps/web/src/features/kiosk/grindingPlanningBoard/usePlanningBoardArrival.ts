import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';

import { useUpdateKioskGrindingPlanningBoardArrival, useUpdateKioskGrindingPlanningBoardFirstProcessArrival } from '../../../api/hooks';
import { usePersistedArrivalFilter } from '../usePersistedArrivalFilter';

import { useFrozenValue, usePlanningBoardOffline } from './offline/PlanningBoardOfflineProvider';

import type { GrindingPlanningBoardFirstProcessState, GrindingPlanningBoardItem, GrindingPlanningBoardResponse } from '@raspi-system/shared-types';

export function usePlanningBoardArrival(data: GrindingPlanningBoardResponse | undefined, nowMs: number, dueSource?: 'excel' | 'scaw') {
  const { gate, snapshot, enabled, refreshRead } = usePlanningBoardOffline();
  useLayoutEffect(() => { if (enabled && snapshot.phase === 'online') { setOverlay(new Map()); setFirstProcessOverlay(new Map()); } }, [enabled, snapshot.phase]);
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
    if (!gate.attempt()) return;
    const generation = gate.generation();
    if (item.standardHoursMissing || pending.current || !siteKey) return;
    pending.current = true;
    try {
      const result = await gate.run(() => firstProcessMutation.mutateAsync({ itemId: item.itemId, itemRevision: item.itemRevision,
        overrideVersion: item.version, state }));
      if (generation !== gate.generation()) return;
      setFirstProcessOverlay((previous) => {
        const next = new Map(previous);
        next.set(item.itemId, { siteKey, state: result.firstProcessState });
        return next;
      });
      if (enabled) void Promise.all([refreshRead('board'), refreshRead('load')]).catch(() => undefined);
    } catch {
      // The popover displays the mutation error next to the arrival controls.
    } finally { pending.current = false; }
  };
  const changeArrival = async (item: GrindingPlanningBoardItem, recorded: boolean) => {
    if (!gate.attempt()) return;
    const generation = gate.generation();
    if (item.standardHoursMissing || pending.current || !siteKey) return;
    pending.current = true;
    try {
      const result = await gate.run(() => mutation.mutateAsync({ itemId: item.itemId, itemRevision: item.itemRevision,
        overrideVersion: item.version, recorded }));
      if (generation !== gate.generation()) return;
      setOverlay((previous) => {
        const next = new Map(previous);
        if (result.manualArrivalDate) next.set(item.itemId, { siteKey, date: result.manualArrivalDate });
        else next.delete(item.itemId);
        return next;
      });
      if (enabled) void Promise.all([refreshRead('board'), refreshRead('load')]).catch(() => undefined);
    } catch {
      // The popover displays the mutation error next to the arrival controls.
    } finally { pending.current = false; }
  };
  return { arrivalFilterEnabled, toggleArrivalFilter, applyArrival, changeArrival, changeFirstProcessArrival,
    arrivalPending: useFrozenValue(mutation.isPending || firstProcessMutation.isPending), arrivalError: useFrozenValue(mutation.isError || firstProcessMutation.isError) };
}
