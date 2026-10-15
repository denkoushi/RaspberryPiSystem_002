import { useCallback, useMemo, useRef } from 'react';

import { useKioskGrindingPlanningBoardResourceCapacity, useUpdateKioskGrindingPlanningBoardResourceCapacity } from '../../../../api/hooks';
import { resolveGrindingPlanningBoardResource } from '../sortGrindingPlanningBoardItems';

import { buildPlanningBoardGanttLayout } from './planningBoardGanttLayout';
import { usePersistedPlanningBoardGanttMode } from './usePersistedPlanningBoardGanttMode';
import { usePlanningBoardGanttScale } from './usePersistedPlanningBoardGanttScale';

import type { GanttLayoutOptions } from './planningBoardGanttLayout';
import type { PlanningBoardGanttHandle } from './PlanningBoardGanttView';
import type { GrindingPlanningBoardResourceDailyHours } from '@raspi-system/shared-types';

const DEFAULT_CAPACITY = {};
const EMPTY_ITEMS: GanttLayoutOptions['items'] = [];

export function usePlanningBoardGantt(options: Omit<GanttLayoutOptions, 'scale' | 'dailyHoursByResource'> & {
  enabled: boolean;
  preferenceScope: string;
}) {
  const { enabled, preferenceScope, items, resources, seibanOrder, view, allocation, today, now, category, resourceCategories } = options;
  const { mode, changeMode } = usePersistedPlanningBoardGanttMode();
  const { scale, homeKey, changeScale } = usePlanningBoardGanttScale();
  const capacity = useKioskGrindingPlanningBoardResourceCapacity(enabled);
  const { mutate, isPending, isError } = useUpdateKioskGrindingPlanningBoardResourceCapacity();
  const dailyHoursByResource = capacity.data?.dailyHoursByResource ?? DEFAULT_CAPACITY;
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
  const layout = useMemo(() => buildPlanningBoardGanttLayout({
    items: enabled ? items : EMPTY_ITEMS, allocation, view, seibanOrder, resources: resourceOrder, dailyHoursByResource, today, scale, mode, now, category, resourceCategories
  }), [enabled, items, allocation, view, seibanOrder, resourceOrder, dailyHoursByResource, today, scale, mode, now, category, resourceCategories]);
  const viewRef = useRef<PlanningBoardGanttHandle>(null);
  const scrollToNextOverlap = useCallback(() => viewRef.current?.scrollToNextOverlap(), []);
  const scrollToNextLate = useCallback(() => viewRef.current?.scrollToNextLate(), []);
  const changeCapacity = useCallback((resourceCd: string, dailyHours: GrindingPlanningBoardResourceDailyHours) => {
    if (!isPending) mutate({ resourceCd, dailyHours });
  }, [isPending, mutate]);
  return { mode, changeMode, scrollToNextLate, scale, homeKey, changeScale, layout, viewRef, scrollToNextOverlap, dailyHoursByResource,
    capacityPending: isPending, capacityError: isError, changeCapacity };
}
