import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';

import { pageZoom } from '../pageZoom';

import { beginForwardDropCache, endForwardDropCache } from './planningBoardForwardDrop';

import type { ForwardDragPreview } from './PlanningBoardForwardGanttRow';
import type { ForwardDragLane } from './planningBoardSingleResourceWindows';

/**
 * The live preview outside React state. Rows and lanes read only the primitives they draw (dragged id, insertion left, dimming),
 * so a changed drop target re-renders just the components whose values change, not the whole Gantt.
 */
export type ForwardDragStore = {
  get: () => ForwardDragPreview | null;
  subscribe: (listener: () => void) => () => void;
  /** Bumped whenever the drop target, or start/end of a drag, changes. */
  version: () => number;
};

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
  const storeListeners = useRef(new Set<() => void>());
  const versionRef = useRef(0);
  const store = useRef<ForwardDragStore>({
    get: () => current.current,
    subscribe: (listener) => { storeListeners.current.add(listener); return () => { storeListeners.current.delete(listener); }; },
    version: () => versionRef.current
  }).current;
  const notifyStore = useCallback(() => {
    versionRef.current += 1;
    storeListeners.current.forEach(listener => listener());
  }, []);
  const setPreview = useCallback((next: ForwardDragPreview | null) => {
    if (next) pointer.current = { x: next.x, y: next.y };
    if (!next || !current.current) {
      if (frame.current !== null) cancelAnimationFrame(frame.current);
      frame.current = null;
      pending.current = null;
      if (next) beginForwardDropCache(); else endForwardDropCache();
      current.current = next;
      publish(next);
      notifyStore();
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
        ghost.style.transform = ghostTransform(next.x, next.y);
        ghost.style.maxWidth = ghostMaxWidth(next.x);
      }
      listeners.current.forEach(listener => listener());
      const previous = current.current;
      current.current = next;
      // Pointer coordinates belong to the ghost; rows only need a changed insertion target.
      const sameDrop = previous?.drop?.resource === next.drop?.resource && previous?.drop?.rowKey === next.drop?.rowKey
        && previous?.drop?.bar?.item.itemId === next.drop?.bar?.item.itemId
        && previous?.drop?.placement === next.drop?.placement && previous?.drop?.left === next.drop?.left;
      const sameDrag = previous?.bar === next.bar && previous.source === next.source && previous.rowKey === next.rowKey;
      if (sameDrag && sameDrop) return;
      // Subscribed rows and lanes pick up the new drop target; React state changes only when the dragged bar itself does.
      if (!sameDrag) publish(next);
      notifyStore();
    });
  }, [notifyStore]);
  useEffect(() => () => { if (frame.current !== null) cancelAnimationFrame(frame.current); if (current.current !== null) endForwardDropCache(); }, []);
  return [preview, setPreview, pointer, subscribe, store] as const;
}

/** Fixed-position boxes shrink to fit the room right of `left`; with a transform the same limit is set explicitly. */
export function ghostMaxWidth(x: number) {
  return `calc(100% - ${x / pageZoom() + 12}px)`;
}

/** The ghost follows the pointer by transform so moving it never invalidates layout. */
export function ghostTransform(x: number, y: number) {
  return `translate3d(${x / pageZoom() + 12}px, ${y / pageZoom() + 12}px, 0) scale(1.05)`;
}

/** Drag state shared by the two panes of the two-machine view so a bar can move between them. */
export type SharedForwardDrag = {
  preview: ForwardDragPreview | null;
  selectionPreview: ForwardDragPreview | null;
  pointer: { readonly current: { x: number; y: number } };
  subscribe: (listener: () => void) => () => void;
  store: ForwardDragStore;
  setPreview: (preview: ForwardDragPreview | null) => void;
  lanes: { readonly current: readonly ForwardDragLane[] };
  registerLanes: (resource: string, lanes: readonly ForwardDragLane[] | null) => void;
};

export function usePlanningBoardSharedDrag(sharedDrag: SharedForwardDrag | undefined, resource: string | undefined | null,
  dragLanes: readonly ForwardDragLane[]) {
  const [localPreview, setLocalPreview, localPointer, localSubscribe, localStore] = usePlanningBoardDragPreview();
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
    dragStore: sharedDrag?.store ?? localStore,
    setDragPreview: sharedDrag?.setPreview ?? setLocalPreview,
    dragLanes: sharedDrag?.lanes ?? latestDragLanes,
    // Only the pane the bar came from draws the ghost and arrow, so they appear once.
    ownsDragPreview: !sharedDrag || (dragPreview?.source === 'shelf' ? sharedDrag.lanes.current[0]?.resource === resource : dragPreview?.bar.resource === resource)
  };
}
