import { memo, useMemo, useSyncExternalStore } from 'react';

import { PlanningBoardForwardGanttRow } from './PlanningBoardForwardGanttRow';

import type { ForwardDragPreview } from './PlanningBoardForwardGanttRow';
import type { ForwardDragStore } from './usePlanningBoardSharedDrag';
import type { ComponentProps, HTMLAttributes, ReactNode } from 'react';

type RowProps = ComponentProps<typeof PlanningBoardForwardGanttRow>;

/** The preview a lane or row reacts to: the live drag, else a shelf selection. */
const effectivePreview = (store: ForwardDragStore, fallback: ForwardDragPreview | null) => store.get() ?? fallback;

/** A lane wrapper that dims or outlines itself from the drag store, so the Gantt view need not re-render. */
export const PlanningBoardForwardLaneFrame = memo(function PlanningBoardForwardLaneFrame({ store, fallback, laneResource: resource, children, ...rest }: {
  store: ForwardDragStore;
  fallback: ForwardDragPreview | null;
  laneResource: string | null | undefined;
  children: ReactNode;
} & Omit<HTMLAttributes<HTMLDivElement>, 'style'>) {
  const dimmed = useSyncExternalStore(store.subscribe, () => {
    const preview = effectivePreview(store, fallback);
    return Boolean(preview && resource && !preview.allowed.has(resource));
  });
  const outlined = useSyncExternalStore(store.subscribe, () => {
    const preview = effectivePreview(store, fallback);
    return preview?.drop?.resource === resource && resource !== preview?.bar.resource;
  });
  return <div {...rest} style={{ opacity: dimmed ? 0.3 : undefined, outline: outlined ? '3px solid rgb(110 231 183)' : undefined, outlineOffset: -3 }}>{children}</div>;
});

/** A Gantt row that reads only its own dragged id and insertion position, so other rows stay memoized while the drop target moves. */
export const PlanningBoardForwardRowBinding = memo(function PlanningBoardForwardRowBinding({ store, fallback, resource, folded, ...rowProps }:
  Omit<RowProps, 'draggedItemId' | 'insertionLeft'> & {
    store: ForwardDragStore;
    fallback: ForwardDragPreview | null;
    resource: string | null | undefined;
    folded: boolean;
  }) {
  const { row } = rowProps;
  const barIds = useMemo(() => new Set(row.bars.map((bar) => bar.item.itemId)), [row.bars]);
  const draggedItemId = useSyncExternalStore(store.subscribe, () => {
    const id = effectivePreview(store, fallback)?.bar.item.itemId;
    return id !== undefined && barIds.has(id) ? id : null;
  });
  const insertionLeft = useSyncExternalStore(store.subscribe, () => {
    const drop = effectivePreview(store, fallback)?.drop;
    return drop && drop.resource === resource && (!folded || drop.rowKey === row.key) ? drop.left : null;
  });
  return <PlanningBoardForwardGanttRow {...rowProps} draggedItemId={draggedItemId} insertionLeft={insertionLeft} />;
});
