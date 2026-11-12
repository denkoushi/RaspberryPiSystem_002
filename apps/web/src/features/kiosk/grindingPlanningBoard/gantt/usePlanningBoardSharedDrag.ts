import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';

import { pageZoom } from '../pageZoom';

import type { ForwardDragPreview } from './PlanningBoardForwardGanttRow';
import type { ForwardDragLane } from './planningBoardSingleResourceWindows';

/** Start/end are synchronous; moves publish at most once per animation frame. */
export function usePlanningBoardDragPreview() {
  const [preview, publish] = useState<ForwardDragPreview | null>(null);
  const current = useRef<ForwardDragPreview | null>(null);
  const pointer = useRef({ x: 0, y: 0 });
  const pending = useRef<ForwardDragPreview | null>(null);
  const frame = useRef<number | null>(null);
  const listeners = useRef(new Set<() => void>());
  const subscribe = useCallback((listener: () => void) => {
    listeners.current.add(listener);
    return () => { listeners.current.delete(listener); };
  }, []);
  const setPreview = useCallback((next: ForwardDragPreview | null) => {
    if (next) pointer.current = { x: next.x, y: next.y };
    if (!next || !current.current) {
      if (frame.current !== null) cancelAnimationFrame(frame.current);
      frame.current = null;
      pending.current = null;
      current.current = next;
      publish(next);
      return;
    }
    pending.current = next;
    if (frame.current !== null) return;
    frame.current = requestAnimationFrame(() => {
      frame.current = null;
      const next = pending.current;
      pending.current = null;
      if (!next) return;
      const ghost = document.querySelector<HTMLElement>('[data-testid="planning-gantt-drag-ghost"]');
      if (ghost) {
        ghost.style.left = `${next.x / pageZoom() + 12}px`;
        ghost.style.top = `${next.y / pageZoom() + 12}px`;
      }
      listeners.current.forEach(listener => listener());
      const previous = current.current;
      current.current = next;
      // Pointer coordinates belong to the ghost; rows only need a changed insertion target.
      if (previous?.bar === next.bar && previous.source === next.source && previous.rowKey === next.rowKey
        && previous.drop?.resource === next.drop?.resource && previous.drop?.rowKey === next.drop?.rowKey
        && previous.drop?.bar?.item.itemId === next.drop?.bar?.item.itemId
        && previous.drop?.placement === next.drop?.placement && previous.drop?.left === next.drop?.left) return;
      publish(next);
    });
  }, []);
  useEffect(() => () => { if (frame.current !== null) cancelAnimationFrame(frame.current); }, []);
  return [preview, setPreview, pointer, subscribe] as const;
}

/** Drag state shared by the two panes of the two-machine view so a bar can move between them. */
export type SharedForwardDrag = {
  preview: ForwardDragPreview | null;
  pointer: { readonly current: { x: number; y: number } };
  subscribe: (listener: () => void) => () => void;
  setPreview: (preview: ForwardDragPreview | null) => void;
  lanes: { readonly current: readonly ForwardDragLane[] };
  registerLanes: (resource: string, lanes: readonly ForwardDragLane[] | null) => void;
};

export function usePlanningBoardSharedDrag(sharedDrag: SharedForwardDrag | undefined, resource: string | undefined | null,
  dragLanes: readonly ForwardDragLane[]) {
  const [localPreview, setLocalPreview, localPointer, localSubscribe] = usePlanningBoardDragPreview();
  const dragPreview = sharedDrag ? sharedDrag.preview : localPreview;
  const latestDragLanes = useRef(dragLanes);
  useLayoutEffect(() => { latestDragLanes.current = dragLanes; }, [dragLanes]);
  const registerLanes = sharedDrag?.registerLanes;
  useLayoutEffect(() => {
    if (!registerLanes || !resource) return;
    registerLanes(resource, dragLanes);
    return () => registerLanes(resource, null);
  }, [registerLanes, resource, dragLanes]);
  return {
    dragPreview,
    dragPointer: sharedDrag?.pointer ?? localPointer,
    subscribePreview: sharedDrag?.subscribe ?? localSubscribe,
    setDragPreview: sharedDrag?.setPreview ?? setLocalPreview,
    dragLanes: sharedDrag?.lanes ?? latestDragLanes,
    // Only the pane the bar came from draws the ghost and arrow, so they appear once.
    ownsDragPreview: !sharedDrag || (dragPreview?.source === 'shelf' ? sharedDrag.lanes.current[0]?.resource === resource : dragPreview?.bar.resource === resource)
  };
}
