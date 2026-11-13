import { useLayoutEffect, useMemo, useRef } from 'react';

import { planningBoardResourceMatches } from '../planningBoardTwoMachine';

import { isNormalGanttBar } from './planningBoardGanttLayout';
import { planningBoardSeibanColor } from './planningBoardSeibanColor';
import { buildPlanningBoardSeibanShelf } from './planningBoardSeibanShelfData';

import type { GanttBar, GanttLayout, NormalGanttBar } from './planningBoardGanttLayout';
import type { SeibanShelfColumn } from './planningBoardSeibanShelfData';
import type { GrindingPlanningBoardItem } from '@raspi-system/shared-types';

const EMPTY_COLUMNS: SeibanShelfColumn[] = [];

export function planningBoardBarsOnResource(bars: readonly GanttBar[], resource?: string | null): NormalGanttBar[] {
  return bars.filter(isNormalGanttBar).filter(bar => !resource || planningBoardResourceMatches(resource, bar.resource));
}

export function planningBoardSeibansWithVisibleBars(bars: readonly GanttBar[], resource?: string | null): ReadonlySet<string> {
  return new Set(planningBoardBarsOnResource(bars, resource).map(bar => bar.item.fseiban));
}

export function usePlanningBoardSeibanShelf(layout: GanttLayout, items: readonly GrindingPlanningBoardItem[] | undefined,
  resources: readonly string[], seibanOrder: readonly string[], visibleSeibans: ReadonlySet<string>, enabled = true) {
  return useMemo(() => {
    if (!enabled) return EMPTY_COLUMNS;
    const bars = [...layout.groups.flatMap(group => group.rows.flatMap(row => row.bars)), ...(layout.forwardQueue ?? [])];
    const members = items ?? bars.filter(isNormalGanttBar).map(bar => bar.item);
    const seibans = [...new Set(members.filter(item => visibleSeibans.has(item.fseiban)).map(item => item.fseiban))];
    const rank = (seiban: string) => { const index = seibanOrder.indexOf(seiban); return index < 0 ? seibanOrder.length : index; };
    seibans.sort((a, b) => rank(a) - rank(b));
    const colors = new Map(seibans.map(seiban => [seiban, planningBoardSeibanColor(seiban, seibanOrder)]));
    return buildPlanningBoardSeibanShelf(members, bars, resources, colors);
  }, [layout, items, resources, seibanOrder, visibleSeibans, enabled]);
}

export function usePlanningBoardSeibanColors(visibleSeibans: ReadonlySet<string>, colorBySeiban: boolean, seibanOrder: readonly string[]) {
  const incomingColors = useMemo(() => {
    if (!colorBySeiban) return undefined;
    const seibans = [...visibleSeibans];
    // The legend follows the left pane's seiban priority; seibans outside it keep their first-seen order at the end.
    const rank = (seiban: string) => { const index = seibanOrder.indexOf(seiban); return index < 0 ? seibanOrder.length : index; };
    seibans.sort((a, b) => rank(a) - rank(b));
    return new Map(seibans.map((seiban) => [seiban, planningBoardSeibanColor(seiban, seibanOrder)] as const));
  }, [colorBySeiban, visibleSeibans, seibanOrder]);
  const previousColors = useRef(incomingColors);
  // eslint-disable-next-line react-hooks/exhaustive-deps -- previousColors is a ref read only to keep the prior identity.
  const seibanColors = useMemo(() => JSON.stringify([...(incomingColors ?? [])]) === JSON.stringify([...(previousColors.current ?? [])]) && Boolean(incomingColors) === Boolean(previousColors.current)
    ? previousColors.current : incomingColors, [incomingColors]);
  useLayoutEffect(() => { previousColors.current = seibanColors; }, [seibanColors]);
  return seibanColors;
}
