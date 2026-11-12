import { useLayoutEffect, useState } from 'react';
import { createPortal } from 'react-dom';

import { pageZoom } from '../pageZoom';

import type { ForwardDragPreview } from './PlanningBoardForwardGanttRow';
import type { RefObject } from 'react';

export function PlanningBoardDragArrow({ preview, viewport }: {
  preview: ForwardDragPreview;
  viewport: RefObject<HTMLDivElement | null>;
}) {
  const [points, setPoints] = useState<{ x: number; y: number; tx: number; ty: number } | null>(null);
  useLayoutEffect(() => {
    const id = preview.bar.item.itemId;
    const board = viewport.current?.closest('[data-testid="planning-two-machine"]');
    const scope = board ?? viewport.current;
    const origin = preview.source === 'queue'
      ? document.querySelector<HTMLElement>(`[data-testid="planning-forward-queue-card-${id}"]`)
      : (preview.rowKey ? Array.from(scope?.querySelectorAll<HTMLElement>('[data-gantt-window-row]') ?? []).find((row) => row.dataset.ganttWindowRow === preview.rowKey
        && (!board || row.dataset.resourceCode === preview.bar.resource)) : scope)?.querySelector<HTMLElement>(`[data-testid="planning-gantt-bar-${id}"]`);
    const from = origin?.getBoundingClientRect();
    const insertion = document.querySelector<HTMLElement>('[data-testid="planning-forward-queue-insertion"]') ??
      scope?.querySelector<HTMLElement>('[data-testid="planning-gantt-insertion"]');
    const to = insertion?.getBoundingClientRect();
    if (!from || !to) { setPoints(null); return; }
    const zoom = pageZoom();
    setPoints({ x: (from.left + from.width / 2) / zoom, y: (from.top + from.height / 2) / zoom,
      tx: (to.left + to.width / 2) / zoom, ty: (to.top + to.height / 2) / zoom });
  }, [preview, viewport]);
  if (!points) return null;
  const { x, y, tx, ty } = points;
  return createPortal(<svg data-testid="planning-gantt-drag-arrow" className="pointer-events-none fixed inset-0 z-[109] h-full w-full overflow-visible" aria-hidden="true">
    <defs><marker id="planning-forward-arrow" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto"><path d="M0 0L8 4L0 8Z" fill="rgb(52 211 153)" /></marker></defs>
    <path d={`M${x} ${y} Q${(x + tx) / 2} ${Math.min(y, ty) - 35} ${tx} ${ty}`} fill="none" stroke="rgb(52 211 153)" strokeWidth="3" markerEnd="url(#planning-forward-arrow)" />
  </svg>, document.body);
}
