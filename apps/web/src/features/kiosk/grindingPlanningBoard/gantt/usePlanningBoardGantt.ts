import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { useKioskGrindingPlanningBoardResourceCapacity, useUpdateKioskGrindingPlanningBoardResourceCapacity } from '../../../../api/hooks';
import { resolveGrindingPlanningBoardResource } from '../sortGrindingPlanningBoardItems';

import { buildPlanningBoardGanttLayout } from './planningBoardGanttLayout';
import { usePersistedPlanningBoardGanttMode } from './usePersistedPlanningBoardGanttMode';
import { usePlanningBoardGanttScale } from './usePersistedPlanningBoardGanttScale';
import { usePersistedPlanningBoardSingleResource } from './usePersistedPlanningBoardSingleResource';

import type { GanttLayoutOptions } from './planningBoardGanttLayout';
import type { PlanningBoardGanttHandle } from './PlanningBoardGanttView';
import type { GrindingPlanningBoardResourceDailyHours } from '@raspi-system/shared-types';

const DEFAULT_CAPACITY = {};
const EMPTY_ITEMS: GanttLayoutOptions['items'] = [];

export function usePlanningBoardGantt(options: Omit<GanttLayoutOptions, 'scale' | 'dailyHoursByResource' | 'runsThroughBreaks'> & {
  enabled: boolean;
  preferenceScope: string;
}) {
  const { enabled, preferenceScope, items, resources, seibanOrder, view, allocation, today, now, category, resourceCategories, laneOrder, arrivalFilterEnabled } = options;
  const { mode, changeMode } = usePersistedPlanningBoardGanttMode();
  const { scale, homeKey, changeScale } = usePlanningBoardGanttScale();
  const capacity = useKioskGrindingPlanningBoardResourceCapacity(enabled);
  const { mutate, isPending, isError } = useUpdateKioskGrindingPlanningBoardResourceCapacity();
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
    changeResource(resource);
    setSingleResourcePickerAnchor(null);
    if (resource) changeMode('forward');
  }, [changeResource, changeMode]);
  useEffect(() => {
    if (!enabled) setSingleResourcePickerAnchor(null);
    if (!enabled || !singleResourceCd) return;
    const escape = (event: KeyboardEvent) => {
      // Dialogs close on window; inspect the still-mounted overlay before leaving single mode.
      if (event.key === 'Escape' && !event.defaultPrevented && !document.querySelector('[role="dialog"], [data-planning-board-popover], [data-forward-queue]')) changeSingleResource(null);
    };
    document.addEventListener('keydown', escape);
    return () => document.removeEventListener('keydown', escape);
  }, [enabled, singleResourceCd, changeSingleResource]);
  const effectiveMode = singleResourceCd ? 'forward' : mode;
  const effectiveView = singleResourceCd ? 'resource' : view;
  const layout = useMemo(() => buildPlanningBoardGanttLayout({
    items: enabled ? items : EMPTY_ITEMS, allocation, view: effectiveView, seibanOrder, resources: resourceOrder, dailyHoursByResource, runsThroughBreaks, today, scale, mode: effectiveMode, now, category, resourceCategories, laneOrder, arrivalFilterEnabled
  }), [enabled, items, allocation, effectiveView, seibanOrder, resourceOrder, dailyHoursByResource, runsThroughBreaks, today, scale, effectiveMode, now, category, resourceCategories, laneOrder, arrivalFilterEnabled]);
  const viewRef = useRef<PlanningBoardGanttHandle>(null);
  const scrollToNextOverlap = useCallback(() => viewRef.current?.scrollToNextOverlap(), []);
  const scrollToNextLate = useCallback(() => viewRef.current?.scrollToNextLate(), []);
  const changeCapacity = useCallback((resourceCd: string, dailyHours: GrindingPlanningBoardResourceDailyHours) => {
    if (!isPending) mutate({ resourceCd, dailyHours });
  }, [isPending, mutate]);
  const changeBreaks = useCallback((resourceCd: string, runsThroughBreaks: boolean) => {
    if (!isPending) mutate({ resourceCd, runsThroughBreaks });
  }, [isPending, mutate]);
  return { mode: effectiveMode, changeMode: (next: 'forward' | 'backward') => { if (next === 'backward') changeSingleResource(null); changeMode(next); },
    singleResourceCd, singleResourcePickerAnchor, openSingleResourcePicker, closeSingleResourcePicker, changeSingleResource, singleResourceLanes: resourceOrder, scrollToNextLate, scale, homeKey, changeScale, layout, viewRef, scrollToNextOverlap, dailyHoursByResource, runsThroughBreaks, changeBreaks,
    capacityPending: isPending, capacityError: isError, changeCapacity };
}
