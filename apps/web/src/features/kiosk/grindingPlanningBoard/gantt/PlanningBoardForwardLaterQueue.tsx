import clsx from 'clsx';
import { Fragment, useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

import { normalizeMachineName } from '../../productionSchedule/machineName';

import { forwardLaterQueue } from './forwardLaterQueue';
import { findForwardDrop } from './planningBoardForwardDrop';
import { forwardStartLabel } from './planningBoardForwardQueue';

import type { ForwardDragPreview, ForwardMove, ForwardReorder } from './PlanningBoardForwardGanttRow';
import type { GanttBar } from './planningBoardGanttLayout';
import type { GrindingPlanningBoardItem } from '@raspi-system/shared-types';
import type { PointerEvent, RefObject } from 'react';

// The edge column covers the right end of the track, so jobs under it count as later.
export const LATER_QUEUE_EDGE_WIDTH = 14;

type Lane = { resource: string; bars: GanttBar[] };
type Props = {
  viewport: RefObject<HTMLDivElement | null>;
  lanes: readonly Lane[];
  start: number;
  dayWidth: number;
  labelWidth: number;
  viewportWidth: number;
  disabled: boolean;
  onDragPreview: (preview: ForwardDragPreview | null) => void;
  onResourceReorder: ForwardReorder;
  onResourceMove: ForwardMove;
  canMoveResource: (item: GrindingPlanningBoardItem, resource: string) => boolean;
  onOpenChange?: (open: boolean) => void;
};
type Drag = { bar: GanttBar; x: number; y: number; pointerId: number; element: HTMLDivElement;
  moved: boolean; allowed: ReadonlySet<string> };

// Scroll state lives here: neither the view nor its memoized rows subscribe to it.
export function PlanningBoardForwardLaterQueue({ viewport, lanes, start, dayWidth, labelWidth, viewportWidth,
  disabled, onDragPreview, onResourceReorder, onResourceMove, canMoveResource, onOpenChange }: Props) {
  const [right, setRight] = useState(start);
  const [open, setOpen] = useState<string | null>(null);
  const isOpen = open !== null;
  useEffect(() => {
    onOpenChange?.(isOpen);
    return () => { if (isOpen) onOpenChange?.(false); };
  }, [isOpen, onOpenChange]);
  const [hosts, setHosts] = useState<HTMLElement[]>([]);
  const drag = useRef<Drag | null>(null);
  const suppressClick = useRef(false);
  const clear = useCallback(() => {
    const pending = drag.current;
    drag.current = null;
    if (pending?.moved) onDragPreview(null);
    if (pending?.element.hasPointerCapture?.(pending.pointerId)) pending.element.releasePointerCapture(pending.pointerId);
  }, [onDragPreview]);
  useEffect(() => {
    setHosts(Array.from(viewport.current?.querySelectorAll<HTMLElement>('[data-later-queue-host]') ?? []));
    const element = viewport.current;
    if (!element) return;
    let frame: number | null = null;
    const measure = () => {
      frame = null;
      setRight(start + (element.scrollLeft + (element.clientWidth || viewportWidth) - labelWidth - LATER_QUEUE_EDGE_WIDTH) / dayWidth);
    };
    const schedule = () => { if (frame === null) frame = requestAnimationFrame(measure); };
    // The parent's home-position effect runs after layout; measure that position on the next frame too.
    measure();
    schedule();
    element.addEventListener('scroll', schedule, { passive: true });
    return () => { element.removeEventListener('scroll', schedule); if (frame !== null) cancelAnimationFrame(frame); };
  }, [viewport, lanes, start, dayWidth, labelWidth, viewportWidth]);
  useEffect(() => {
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') clear(); };
    window.addEventListener('blur', clear);
    document.addEventListener('keydown', escape);
    return () => { clear(); window.removeEventListener('blur', clear); document.removeEventListener('keydown', escape); };
  }, [clear]);
  useEffect(() => { clear(); }, [disabled, lanes, dayWidth, clear]);
  const findDrop = (event: PointerEvent<HTMLDivElement>, pending: Drag) => findForwardDrop(event.clientX, event.clientY,
    pending.bar, pending.allowed, viewport.current?.closest('[data-testid="planning-board-gantt"]'), lanes, start, dayWidth);
  const move = (event: PointerEvent<HTMLDivElement>) => {
    const pending = drag.current;
    if (!pending || pending.pointerId !== event.pointerId || disabled) return null;
    const dx = Math.abs(event.clientX - pending.x);
    const dy = Math.abs(event.clientY - pending.y);
    if (!pending.moved) {
      if (event.pointerType === 'touch') {
        // The tray scrolls sideways under touch. Once a gesture chooses horizontal scrolling, never turn it into a drag.
        if (dx >= 8 && dx >= dy) { suppressClick.current = true; drag.current = null; return null; }
        if (dy < 8) return null;
      } else if (Math.hypot(dx, dy) < 8) return null;
      pending.moved = true;
      suppressClick.current = true;
      pending.element.setPointerCapture?.(pending.pointerId);
    }
    const drop = findDrop(event, pending);
    onDragPreview({ bar: pending.bar, x: event.clientX, y: event.clientY, allowed: pending.allowed, drop });
    return drop;
  };
  const card = (bar: GanttBar) => <div key={bar.item.itemId}
    data-testid={`planning-forward-later-card-${bar.item.itemId}`}
    className={clsx('min-h-11 w-[150px] shrink-0 touch-pan-x select-none rounded-lg border-l-[5px] bg-slate-950 px-2 py-2 text-left text-xs tabular-nums',
      bar.tone === 'late' ? 'border-rose-400' : 'border-sky-400')}
    onPointerDown={(event) => {
      suppressClick.current = false;
      if (disabled || event.button !== 0 || event.isPrimary === false || drag.current) return;
      drag.current = { bar, x: event.clientX, y: event.clientY, pointerId: event.pointerId, element: event.currentTarget, moved: false,
        allowed: new Set(lanes.filter((lane) => lane.resource === bar.resource || canMoveResource(bar.item, lane.resource)).map((lane) => lane.resource)) };
    }} onPointerMove={move} onPointerUp={(event) => {
      const pending = drag.current;
      if (!pending || pending.pointerId !== event.pointerId) return;
      const drop = move(event);
      clear();
      if (!drop || disabled) return;
      if (drop.resource !== pending.bar.resource) onResourceMove(pending.bar.item, drop.resource, drop.bar?.item ?? null, drop.placement);
      else if (drop.bar) onResourceReorder(pending.bar.item, drop.bar.item, drop.placement);
    }} onPointerCancel={clear} onLostPointerCapture={() => { if (drag.current?.moved) clear(); }}>
    <>
    <div className="truncate text-slate-400">{[bar.item.fseiban, bar.unknown ? '所要不明' : `${bar.item.requiredMinutes}分`, bar.item.plannedQuantity == null ? null : `${bar.item.plannedQuantity}個`].filter((part) => part != null && part !== '').join(' · ')}</div>
    <strong className="my-0.5 block truncate text-sm" title={bar.item.fhinmei || bar.item.fhincd}>{bar.item.fhinmei || bar.item.fhincd}</strong>
    <div className="truncate text-slate-400">{bar.item.fhincd}</div>
    <div className="truncate text-slate-400">{normalizeMachineName(bar.item.machineName)}</div>
    <div className="truncate text-slate-400">{forwardStartLabel(bar)}</div>
    </>
  </div>;
  return <>{lanes.map((lane, index) => {
    const queue = forwardLaterQueue(lane.bars, right);
    const columnHost = hosts.find((host) => host.dataset.laterQueueHost === `column-${index}`);
    const trayHost = hosts.find((host) => host.dataset.laterQueueHost === `tray-${index}`);
    if (!queue.count || !columnHost || !trayHost) return null;
    const expanded = open === lane.resource;
    return <Fragment key={lane.resource}>
      {createPortal(<div role="button" tabIndex={0} aria-label={`${lane.resource}の先の待ち`} aria-expanded={expanded}
        data-later-queue className={clsx('pointer-events-auto sticky right-0 z-20 flex shrink-0 items-center justify-center border-l-2',
          expanded ? 'border-amber-400 bg-[#13203a] text-amber-400' : 'border-slate-700 bg-[#0b1222] text-slate-400')} style={{ width: LATER_QUEUE_EDGE_WIDTH }}
        onPointerDown={() => { suppressClick.current = false; }}
        onClick={() => { if (!suppressClick.current) setOpen(expanded ? null : lane.resource); suppressClick.current = false; }}
        onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); setOpen(expanded ? null : lane.resource); } }}>
        <svg viewBox="0 0 16 16" className={clsx('h-2.5 w-2.5', expanded && 'rotate-90')} fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M4 3l5 5-5 5M9 3l5 5-5 5" /></svg>
      </div>, columnHost)}
      {expanded && createPortal(<div role="region" data-later-queue aria-label={`${lane.resource}の先の待ち一覧`}
        className="sticky left-0 flex gap-1.5 overflow-x-auto border-b border-slate-600 bg-slate-900 p-2 text-slate-100"
        style={{ width: viewportWidth }}>
        {queue.bars.map((bar) => card(bar))}
      </div>, trayHost)}
    </Fragment>;
  })}</>;
}
