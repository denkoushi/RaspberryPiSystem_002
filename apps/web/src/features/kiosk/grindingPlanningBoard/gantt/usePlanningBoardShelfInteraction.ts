import { useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react';

import { findForwardDrop, forwardDropBoard, forwardDropInLane } from './planningBoardForwardDrop';

import type { ForwardDragPreview, ForwardMove, ForwardReorder } from './PlanningBoardForwardGanttRow';
import type { GanttBar } from './planningBoardGanttLayout';
import type { ForwardDragLane } from './planningBoardSingleResourceWindows';
import type { GrindingPlanningBoardItem } from '@raspi-system/shared-types';
import type { RefObject } from 'react';

export type ShelfSelection = { bar: GanttBar; allowed: ReadonlySet<string>; moving: ReadonlySet<string> };

/** The drag look for a chip that is only selected; cleared by passing null. */
export function useShelfSelectionPreview(lanes: readonly ForwardDragLane[], start: number, dayWidth: number) {
  const [selection, setSelection] = useState<ShelfSelection | null>(null);
  const preview = useMemo(() => selection ? shelfSelectionPreview(selection, lanes, start, () => dayWidth) : null,
    [selection, lanes, start, dayWidth]);
  return [preview, setSelection] as const;
}

export function shelfSelectionPreview(selection: ShelfSelection, lanes: readonly ForwardDragLane[],
  start: number, dayWidthFor: (resource: string) => number,
): ForwardDragPreview {
  const { bar, allowed, moving } = selection;
  const candidates = lanes.filter(lane => allowed.has(lane.resource));
  const drop = (targets: readonly ForwardDragLane[]) => {
    for (const lane of targets) {
      const dayWidth = dayWidthFor(lane.resource);
      if (!dayWidth) continue;
      // Find the first valid insertion, using the same anchors as pointer placement.
      for (const x of [0, Infinity]) {
        const target = forwardDropInLane(x, bar, lane, lanes, start, dayWidth, moving);
        if (target && target.bar?.item.kind !== 'test') return target;
      }
    }
    return null;
  };
  return { source: 'shelf-selection', bar, allowed, x: 0, y: 0,
    drop: drop(candidates.filter(lane => lane.resource === bar.resource)) ?? drop(candidates.filter(lane => lane.resource !== bar.resource)) };
}

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
    const drop = findForwardDrop(x, y, source, allowed, forwardDropBoard(viewport.current), current.lanes.current,
      current.start, current.dayWidth, moving);
    return drop?.bar?.item.kind === 'test' ? null : drop;
  }, [viewport]);
  useLayoutEffect(() => {
    if (!shared || !resource) return;
    shared.resolvers.current.set(resource, getDrop);
    return () => { shared.resolvers.current.delete(resource); };
  }, [shared, resource, getDrop]);
  return { localShelf, shelfInteractionRef: shared?.shelf ?? localShelf, shelfActions: actions, getShelfDrop: getDrop };
}
