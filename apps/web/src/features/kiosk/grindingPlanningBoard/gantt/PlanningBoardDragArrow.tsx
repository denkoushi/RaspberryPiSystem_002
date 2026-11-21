import { useLayoutEffect, useState, useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';

import { pageZoom } from '../pageZoom';

import type { ForwardDragPreview } from './PlanningBoardForwardGanttRow';
import type { ForwardDragStore } from './usePlanningBoardSharedDrag';
import type { RefObject } from 'react';

const noopSubscribe = () => () => undefined;
const noVersion = () => 0;

export function PlanningBoardDragArrow({ preview, viewport, subscribe, store }: {
  preview: ForwardDragPreview;
  subscribe: (listener: () => void) => () => void;
  /** When given, the arrow re-measures after a drop-target change and on scroll or resize, not on every pointer frame. */
  store?: ForwardDragStore;
  viewport: RefObject<HTMLDivElement | null>;
}) {
  const dropVersion = useSyncExternalStore(store?.subscribe ?? noopSubscribe, store?.version ?? noVersion);
  const [points, setPoints] = useState<{ x: number; y: number; tx: number; ty: number } | null>(null);
  useLayoutEffect(() => {
    const measure = () => {
      const id = preview.bar.item.itemId;
      const board = viewport.current?.closest('[data-testid="planning-two-machine"]');
      const scope = board ?? viewport.current;
      const origin = preview.source === 'queue'
        ? document.querySelector<HTMLElement>(`[data-testid="planning-forward-queue-card-${id}"]`)
        : (preview.rowKey ? Array.from(scope?.querySelectorAll<HTMLElement>('[data-gantt-window-row]') ?? []).find((row) => row.dataset.ganttWindowRow === preview.rowKey
          && (!board || row.dataset.resourceCode === preview.bar.resource)) : scope)?.querySelector<HTMLElement>(`[data-testid="planning-gantt-bar-${id}"]`);
      const tile = preview.source === 'shelf-selection' && !origin
        ? (board ?? viewport.current?.closest('[data-testid="planning-board-gantt"]'))?.querySelector<HTMLElement>(`[data-testid="planning-shelf-tile-${id}"]`) : null;
      const from = (origin ?? tile)?.getBoundingClientRect();
      const insertion = (preview.source !== 'shelf-selection'
        ? document.querySelector<HTMLElement>('[data-testid="planning-forward-queue-insertion"]') : null) ??
        scope?.querySelector<HTMLElement>('[data-testid="planning-gantt-insertion"]');
      const to = insertion?.getBoundingClientRect();
      if (!from || !to) { setPoints(null); return; }
      const zoom = pageZoom();
      const next = { x: (from.left + from.width / 2) / zoom, y: (from.top + from.height / 2) / zoom,
        tx: (to.left + to.width / 2) / zoom, ty: (to.top + to.height / 2) / zoom };
      setPoints(previous => previous?.x === next.x && previous.y === next.y && previous.tx === next.tx && previous.ty === next.ty ? previous : next);
    };
    measure();
    // Auto-scroll may move the marker while the logical drop target stays unchanged.
    // The queue panel keeps its own insertion marker, so queue drags (and callers without a store) still follow every frame.
    if (preview.source === 'shelf-selection' || (store && preview.source !== 'queue')) {
      window.addEventListener('scroll', measure, true);
      window.addEventListener('resize', measure);
      return () => {
        window.removeEventListener('scroll', measure, true);
        window.removeEventListener('resize', measure);
      };
    }
    return subscribe(measure);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- dropVersion only re-runs the measurement after a drop-target commit.
  }, [preview, viewport, subscribe, store, dropVersion]);
  if (!points) return null;
  const { x, y, tx, ty } = points;
  return createPortal(<svg data-testid="planning-gantt-drag-arrow" className="pointer-events-none fixed inset-0 z-[109] h-full w-full overflow-visible" aria-hidden="true">
    <defs><marker id="planning-forward-arrow" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto"><path d="M0 0L8 4L0 8Z" fill="rgb(52 211 153)" /></marker></defs>
    <path d={`M${x} ${y} Q${(x + tx) / 2} ${Math.min(y, ty) - 35} ${tx} ${ty}`} fill="none" stroke="rgb(52 211 153)" strokeWidth="3" markerEnd="url(#planning-forward-arrow)" />
  </svg>, document.body);
}
