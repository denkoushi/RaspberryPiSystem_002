import { useQuery } from '@tanstack/react-query';
import { useMemo, useState } from 'react';

import { getKioskGrindingPlanningBoardSnapshot } from '../../../api/domains/production-schedule/grinding-planning-board';
import { productionScheduleQueryKeys } from '../../../api/queryKeys/productionSchedule';

import type { KioskGrindingPlanningBoardQuery } from '../../../api/domains/production-schedule/grinding-planning-board';
import type { GrindingPlanningBoardItem } from '@raspi-system/shared-types';

export const planningBoardChainCompletedKey = [...productionScheduleQueryKeys.grindingPlanningBoardAll, 'chain-completed'] as const;

export function usePlanningBoardChainItems(params: KioskGrindingPlanningBoardQuery, fseiban: string | null,
  items: readonly GrindingPlanningBoardItem[] | undefined) {
  const enabled = fseiban !== null && params.completionFilter === 'incomplete';
  const queryParams: KioskGrindingPlanningBoardQuery = {
    scheduleSource: params.scheduleSource, category: params.category, view: params.view, dueSource: params.dueSource,
    fseibans: fseiban === null ? [] : [fseiban], completionFilter: 'complete', includePieces: true
  };
  const query = useQuery({
    queryKey: [...planningBoardChainCompletedKey, queryParams],
    queryFn: () => getKioskGrindingPlanningBoardSnapshot(queryParams),
    enabled
  });
  return useMemo(() => {
    const merged = new Map((items ?? []).map(item => [item.itemId, item]));
    if (enabled) for (const item of query.data?.items ?? []) if (!merged.has(item.itemId)) merged.set(item.itemId, item);
    return [...merged.values()];
  }, [items, enabled, query.data]);
}

export function usePlanningBoardPageChainItems(params: KioskGrindingPlanningBoardQuery, items: readonly GrindingPlanningBoardItem[] | undefined) {
  const [fseiban, onChainPartChange] = useState<string | null>(null);
  const chainItems = usePlanningBoardChainItems(params, fseiban, items);
  return { chainItems, onChainPartChange };
}
