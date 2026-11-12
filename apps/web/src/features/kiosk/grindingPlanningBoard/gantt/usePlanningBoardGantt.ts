import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';

import { useKioskGrindingPlanningBoardResourceMinutes, useUpdateKioskGrindingPlanningBoardResourceMinutesSource, useKioskGrindingPlanningBoardResourceCapacity, useUpdateKioskGrindingPlanningBoardResourceCapacity } from '../../../../api/hooks';
import { useFrozenValue, usePlanningBoardOffline } from '../offline/PlanningBoardOfflineProvider';
import { useOfflineResourceMinutes, useOfflineResourceCapacity } from '../offline/planningBoardOfflineQueries';
import { planningBoardResourceMatches } from '../planningBoardTwoMachine';
import { resolveGrindingPlanningBoardResource } from '../sortGrindingPlanningBoardItems';
import { usePlanningBoardQueryData } from '../usePlanningBoardQueryData';

import { buildPlanningBoardGanttLayout } from './planningBoardGanttLayout';
import { usePersistedPlanningBoardGanttMode } from './usePersistedPlanningBoardGanttMode';
import { usePlanningBoardGanttScale } from './usePersistedPlanningBoardGanttScale';
import { usePersistedPlanningBoardSingleResource } from './usePersistedPlanningBoardSingleResource';

import type { PlanningBoardTestBarControls } from '../usePlanningBoardTestBars';
import type { GanttLayoutOptions } from './planningBoardGanttLayout';
import type { PlanningBoardGanttHandle } from './PlanningBoardGanttView';
import type { GrindingPlanningBoardResourceDailyHours } from '@raspi-system/shared-types';

const DEFAULT_CAPACITY = {};
const EMPTY_ITEMS: GanttLayoutOptions['items'] = [];

export function usePlanningBoardGantt(options: Omit<GanttLayoutOptions, 'scale' | 'dailyHoursByResource' | 'runsThroughBreaks'> & {
  enabled: boolean;
  machineSelectionLocked?: boolean;
  preferenceScope: string;
}) {
  const { gate, enabled: offlineEnabled, refreshRead } = usePlanningBoardOffline();
  const { enabled, machineSelectionLocked, preferenceScope, items, resources, seibanOrder, view, allocation, today, now, category, resourceCategories, laneOrder, arrivalFilterEnabled } = options;
  const { mode, changeMode } = usePersistedPlanningBoardGanttMode();
  const { scale, homeKey, changeScale } = usePlanningBoardGanttScale();
  const useMinutes = offlineEnabled ? useOfflineResourceMinutes : useKioskGrindingPlanningBoardResourceMinutes;
  const useCapacity = offlineEnabled ? useOfflineResourceCapacity : useKioskGrindingPlanningBoardResourceCapacity;
  const minutes = useMinutes(enabled);
  const resourceMinutes = usePlanningBoardQueryData(minutes.data);
  const sourceMutation = useUpdateKioskGrindingPlanningBoardResourceMinutesSource();
  const [valueSheetResource, setValueSheetResource] = useState<string | null>(null);
  const capacity = useCapacity(enabled);
  const capacityMutation = useUpdateKioskGrindingPlanningBoardResourceCapacity({ invalidateOnSuccess: !offlineEnabled });
  const { isPending, isError, mutate, mutateAsync } = capacityMutation;
  const latestCapacityWrite = useRef({ gate, isPending, offlineEnabled, refreshRead });
  useLayoutEffect(() => { latestCapacityWrite.current = { gate, isPending, offlineEnabled, refreshRead }; });
  const writeStatus = useFrozenValue({ capacityPending: isPending, capacityError: isError,
    minutesPending: sourceMutation.isPending || minutes.isPending || minutes.isError, minutesError: sourceMutation.isError || minutes.isError });
  const dailyHoursByResource = capacity.data?.dailyHoursByResource ?? DEFAULT_CAPACITY;
  const runsThroughBreaks = useMemo(() => new Set(capacity.data?.runsThroughBreaksResources ?? []), [capacity.data?.runsThroughBreaksResources]);
  const paneResources = useMemo(() => [...new Set([...resources,
    ...items.map((item) => resolveGrindingPlanningBoardResource(item, allocation) ?? '未設定')
  ])], [allocation, items, resources]);
  const resourceOrder = useMemo(() => {
    if (!enabled) return paneResources;
    // Use the normal resource panes' device-local order, including filtered resources.
    try {
      const saved: unknown = JSON.parse(localStorage.getItem(`kiosk.planning-board.resource-panes:${preferenceScope}`) ?? '[]');
      if (Array.isArray(saved)) {
        const order = saved.filter((entry): entry is string => typeof entry === 'string');
        return [...new Set([...order.filter((resource) => paneResources.includes(resource)), ...paneResources])];
      }
    } catch { /* Storage is optional. */ }
    return paneResources;
  }, [enabled, preferenceScope, paneResources]);
  const { resourceCd: singleResourceCd, changeResource } = usePersistedPlanningBoardSingleResource(preferenceScope, paneResources);
  const [singleResourcePickerAnchor, setSingleResourcePickerAnchor] = useState<HTMLElement | null>(null);
  const closeSingleResourcePicker = useCallback(() => setSingleResourcePickerAnchor(null), []);
  const openSingleResourcePicker = useCallback((anchor: HTMLElement) => setSingleResourcePickerAnchor((current) => current === anchor ? null : anchor), []);
  const changeSingleResource = useCallback((resource: string | null) => {
    setValueSheetResource(null);
    changeResource(resource);
    setSingleResourcePickerAnchor(null);
    if (resource) changeMode('forward');
  }, [changeResource, changeMode]);
  useEffect(() => {
    if (!enabled) setSingleResourcePickerAnchor(null);
    if (!enabled || !singleResourceCd) return;
    const escape = (event: KeyboardEvent) => {
      // Dialogs close on window; inspect the still-mounted overlay before leaving single mode.
      if (event.key === 'Escape' && !event.defaultPrevented && !document.querySelector('[role="dialog"], [data-planning-board-popover], [data-forward-queue]')) {
        if (valueSheetResource && planningBoardResourceMatches(singleResourceCd, valueSheetResource, paneResources)) setValueSheetResource(null);
        else if (!machineSelectionLocked) changeSingleResource(null);
      }
    };
    document.addEventListener('keydown', escape);
    return () => document.removeEventListener('keydown', escape);
  }, [enabled, singleResourceCd, changeSingleResource, valueSheetResource, paneResources, machineSelectionLocked]);
  const effectiveMode = singleResourceCd ? 'forward' : mode;
  const effectiveView = singleResourceCd ? 'resource' : view;
  const layout = useMemo(() => buildPlanningBoardGanttLayout({
    testBars: enabled ? options.testBars : undefined,
    items: enabled ? items : EMPTY_ITEMS, allocation, view: effectiveView, seibanOrder, resources: resourceOrder, resourceMinutes, dailyHoursByResource, runsThroughBreaks, today, scale, mode: effectiveMode, now, category, resourceCategories, laneOrder, arrivalFilterEnabled
  }), [options.testBars, enabled, items, allocation, effectiveView, seibanOrder, resourceOrder, resourceMinutes, dailyHoursByResource, runsThroughBreaks, today, scale, effectiveMode, now, category, resourceCategories, laneOrder, arrivalFilterEnabled]);
  const viewRef = useRef<PlanningBoardGanttHandle>(null);
  const scrollToNextOverlap = useCallback(() => viewRef.current?.scrollToNextOverlap(), []);
  const scrollToNextLate = useCallback(() => viewRef.current?.scrollToNextLate(), []);
  // 2台表示では上下段の機械を同じ値にそろえるため、資源CDを複数受け取って順に書く。
  const writeCapacity = useCallback((resourceCds: string | readonly string[], change: { dailyHours?: GrindingPlanningBoardResourceDailyHours; runsThroughBreaks?: boolean }) => {
    const { gate, isPending, offlineEnabled, refreshRead } = latestCapacityWrite.current;
    if (!gate.attempt() || isPending) return;
    const targets = typeof resourceCds === 'string' ? [resourceCds] : [...new Set(resourceCds)];
    if (targets.length === 0) return;
    if (!offlineEnabled && targets.length === 1) { mutate({ resourceCd: targets[0]!, ...change }); return; }
    const writeAll = async () => { for (const resourceCd of targets) await mutateAsync({ resourceCd, ...change }); };
    if (!offlineEnabled) { void writeAll().catch(() => undefined); return; }
    void gate.run(writeAll).then(() =>
      Promise.all(['board', 'load', 'resource-capacity'].map(refreshRead))).catch(() => undefined);
  }, [mutate, mutateAsync]);
  // 2台表示では押していない側の値も渡し、上下段の行の区切りを決める2つの値をまとめてそろえる。
  const changeCapacity = useCallback((resourceCds: string | readonly string[], dailyHours: GrindingPlanningBoardResourceDailyHours, runsThroughBreaks?: boolean) =>
    writeCapacity(resourceCds, runsThroughBreaks === undefined ? { dailyHours } : { dailyHours, runsThroughBreaks }), [writeCapacity]);
  const changeBreaks = useCallback((resourceCds: string | readonly string[], runsThroughBreaks: boolean, dailyHours?: GrindingPlanningBoardResourceDailyHours) =>
    writeCapacity(resourceCds, dailyHours === undefined ? { runsThroughBreaks } : { dailyHours, runsThroughBreaks }), [writeCapacity]);
  const changeUnitSplit = useCallback((resourceCd: string, unitSplitEnabled: boolean) => {
    const { gate, isPending, offlineEnabled, refreshRead } = latestCapacityWrite.current;
    if (!gate.attempt() || isPending) return;
    if (!offlineEnabled) mutate({ resourceCd, unitSplitEnabled });
    else void gate.run(() => mutateAsync({ resourceCd, unitSplitEnabled })).then(() =>
      Promise.all(['board', 'load', 'resource-capacity'].map(refreshRead))).catch(() => undefined);
  }, [mutate, mutateAsync]);
  return { testBarControls: undefined as PlanningBoardTestBarControls | undefined,
    mode: effectiveMode, changeMode: (next: 'forward' | 'backward') => { if (next === 'backward') changeSingleResource(null); changeMode(next); },
    resourceMinutesItems: items, resourceMinutes: minutes.data, minutesPending: writeStatus.minutesPending, minutesError: writeStatus.minutesError,
    changeMinutesSource: (sources: Parameters<typeof sourceMutation.mutate>[0][]) => {
      if (sources.length === 0 || !gate.attempt()) return;
      if (!offlineEnabled) sources.forEach((source) => sourceMutation.mutate(source));
      else void gate.run(async () => {
        for (const source of sources) await sourceMutation.mutateAsync(source);
      }).then(() =>
        Promise.all(['board', 'load', 'resource-minutes'].map(refreshRead))).catch(() => undefined);
    }, valueSheetOpen: valueSheetResource !== null && singleResourceCd !== null && planningBoardResourceMatches(singleResourceCd, valueSheetResource, paneResources),
    valueSheetResource, toggleValueSheet: (resource = singleResourceCd) => setValueSheetResource((current) => current === resource ? null : resource),
    capacityLoaded: capacity.data?.unitSplitEnabledByResource !== undefined, unitSplitEnabledByResource: capacity.data?.unitSplitEnabledByResource, singleResourceCd, singleResourcePickerAnchor, openSingleResourcePicker, closeSingleResourcePicker, changeSingleResource, singleResourceLanes: resourceOrder, scrollToNextLate, scale, homeKey, changeScale, layout, viewRef, scrollToNextOverlap, dailyHoursByResource, runsThroughBreaks, changeBreaks, changeUnitSplit,
    capacityPending: writeStatus.capacityPending, capacityError: writeStatus.capacityError, changeCapacity };
}
