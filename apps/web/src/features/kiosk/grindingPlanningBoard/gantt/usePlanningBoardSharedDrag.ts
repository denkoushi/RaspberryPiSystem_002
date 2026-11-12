import { useLayoutEffect, useRef, useState } from 'react';

import type { ForwardDragPreview } from './PlanningBoardForwardGanttRow';
import type { ForwardDragLane } from './planningBoardSingleResourceWindows';

/** Drag state shared by the two panes of the two-machine view so a bar can move between them. */
export type SharedForwardDrag = {
  preview: ForwardDragPreview | null;
  setPreview: (preview: ForwardDragPreview | null) => void;
  lanes: { readonly current: readonly ForwardDragLane[] };
  registerLanes: (resource: string, lanes: readonly ForwardDragLane[] | null) => void;
};

export function usePlanningBoardSharedDrag(sharedDrag: SharedForwardDrag | undefined, resource: string | undefined | null,
  dragLanes: readonly ForwardDragLane[]) {
  const [localPreview, setLocalPreview] = useState<ForwardDragPreview | null>(null);
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
    setDragPreview: sharedDrag?.setPreview ?? setLocalPreview,
    dragLanes: sharedDrag?.lanes ?? latestDragLanes,
    // Only the pane the bar came from draws the ghost and arrow, so they appear once.
    ownsDragPreview: !sharedDrag || dragPreview?.bar.resource === resource
  };
}
