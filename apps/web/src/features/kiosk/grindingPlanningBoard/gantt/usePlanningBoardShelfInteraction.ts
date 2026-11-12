import { useCallback, useLayoutEffect, useMemo, useRef } from 'react';

import { findForwardDrop, forwardDropBoard } from './planningBoardForwardDrop';

import type { ForwardDragPreview, ForwardMove, ForwardReorder } from './PlanningBoardForwardGanttRow';
import type { GanttBar } from './planningBoardGanttLayout';
import type { ForwardDragLane } from './planningBoardSingleResourceWindows';
import type { GrindingPlanningBoardItem } from '@raspi-system/shared-types';
import type { RefObject } from 'react';

export type ShelfDropResolver = (x: number, y: number, source: GanttBar, allowed: ReadonlySet<string>, moving: ReadonlySet<string>) => ForwardDragPreview['drop'];
export type SeibanShelfHandle = {
  placeAt: (x: number, y: number) => boolean;
};
export type ShelfPlacementActions = {
  move: ForwardMove;
  reorder: ForwardReorder;
  canMove: (item: GrindingPlanningBoardItem, resource: string) => boolean;
};
export type SharedShelfInteraction = {
  shelf: RefObject<SeibanShelfHandle | null>;
  resolvers: RefObject<Map<string, ShelfDropResolver>>;
};


export function usePlanningBoardShelfInteraction(shared: SharedShelfInteraction | undefined, resource: string | null,
  lanes: { readonly current: readonly ForwardDragLane[] }, viewport: RefObject<HTMLDivElement | null>, start: number, dayWidth: number,
  rowActions: { onResourceMove: ForwardMove; onResourceReorder: ForwardReorder; canMoveResource: ShelfPlacementActions['canMove'] }) {
  const localShelf = useRef<SeibanShelfHandle | null>(null);
  const actions = useMemo(() => ({ move: rowActions.onResourceMove, reorder: rowActions.onResourceReorder, canMove: rowActions.canMoveResource }), [rowActions]);
  const geometry = useRef({ lanes, start, dayWidth });
  useLayoutEffect(() => { geometry.current = { lanes, start, dayWidth }; });
  const getDrop = useCallback<ShelfDropResolver>((x, y, source, allowed, moving) => {
    const current = geometry.current;
    return findForwardDrop(x, y, source, allowed, forwardDropBoard(viewport.current), current.lanes.current,
      current.start, current.dayWidth, moving);
  }, [viewport]);
  useLayoutEffect(() => {
    if (!shared || !resource) return;
    shared.resolvers.current.set(resource, getDrop);
    return () => { shared.resolvers.current.delete(resource); };
  }, [shared, resource, getDrop]);
  return { localShelf, shelfInteractionRef: shared?.shelf ?? localShelf, shelfActions: actions, getShelfDrop: getDrop };
}
