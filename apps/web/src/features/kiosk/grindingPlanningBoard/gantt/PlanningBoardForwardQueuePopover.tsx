import clsx from 'clsx';
import { forwardRef, useCallback, useEffect, useImperativeHandle, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

import { normalizeMachineName } from '../../productionSchedule/machineName';
import { pageZoom } from '../pageZoom';
import { formatPlanningBoardItemMinutes } from '../planningBoardLoad';

import { ganttResourceLabel } from './ganttResourceLabel';
import { findForwardDrop } from './planningBoardForwardDrop';
import { canReorderForwardBars, forwardDueLabel, forwardQueueWindow, forwardStartLabel } from './planningBoardForwardQueue';

import type { ForwardDragPreview, ForwardMove, ForwardReorder } from './PlanningBoardForwardGanttRow';
import type { GanttBar, GanttLayout } from './planningBoardGanttLayout';
import type { GrindingPlanningBoardItem, GrindingPlanningBoardResourceOrderPlacement } from '@raspi-system/shared-types';
import type { PointerEvent, RefObject } from 'react';

type OpenQueue = { itemId: string; anchor: HTMLButtonElement };
type Drop = { bar: GanttBar; placement: GrindingPlanningBoardResourceOrderPlacement };
type Drag = { bar: GanttBar; x: number; pointerId: number; element: HTMLDivElement; moved: boolean; y: number; ready: boolean; allowed: ReadonlySet<string> };
export type ForwardQueueHandle = {
  show: (bar: GanttBar, anchor: HTMLButtonElement, pinned?: boolean) => void;
  isPinned: () => boolean;
  closeUnlessPinned: () => void;
  hideSoon: () => void;
  close: () => void;
};
type Props = {
  viewport: RefObject<HTMLDivElement | null>;
  lanes: readonly { resource: string; bars: GanttBar[] }[];
  start: number;
  dayWidth: number;
  labelWidth: number;
  viewportWidth: number;
  onDragPreview: (preview: ForwardDragPreview | null) => void;
  draggedItemId: string | null;
  onResourceMove?: ForwardMove;
  canMoveResource?: (item: GrindingPlanningBoardItem, resource: string) => boolean;
  layout: GanttLayout;
  scale: number;
  resourceNameMap: Record<string, string[]>;
  disabled: boolean;
  dragDisabled: boolean;
  resourceView: boolean;
  onResourceReorder?: ForwardReorder;
  onArrivalChange?: (item: GrindingPlanningBoardItem, recorded: boolean) => void;
  onFirstProcessArrivalChange?: (item: GrindingPlanningBoardItem, state: NonNullable<GrindingPlanningBoardItem['firstProcessState']> | null) => void;
  arrivalPending?: boolean;
  arrivalError?: boolean;
};

export const PlanningBoardForwardQueuePopover = forwardRef<ForwardQueueHandle, Props>(function PlanningBoardForwardQueuePopover({
  viewport, lanes, start, dayWidth, labelWidth, viewportWidth, onDragPreview, draggedItemId, onResourceMove, canMoveResource,
  layout, scale, resourceNameMap, disabled, dragDisabled, resourceView, onResourceReorder, onArrivalChange, onFirstProcessArrivalChange, arrivalPending, arrivalError
}, ref) {
  const [open, setOpen] = useState<OpenQueue | null>(null);
  const pinned = useRef(false);
  const [isPinned, setPinned] = useState(false);
  const pin = () => { pinned.current = true; setPinned(true); cancelHide(); };
  const scroll = useRef<HTMLDivElement>(null);
  const longPress = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const [visibleRange, setVisibleRange] = useState({ left: 0, right: 0 });
  useEffect(() => {
    const element = viewport.current;
    if (!element) return;
    const measure = () => setVisibleRange({ left: element.scrollLeft, right: element.scrollLeft + (element.clientWidth || viewportWidth) - labelWidth });
    measure();
    element.addEventListener('scroll', measure, { passive: true });
    return () => element.removeEventListener('scroll', measure);
  }, [viewport, viewportWidth, labelWidth, layout]);
  const [position, setPosition] = useState({ left: 8, top: 8 });
  const [drop, setDrop] = useState<Drop | null>(null);
  const panel = useRef<HTMLDivElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const drag = useRef<Drag | null>(null);
  const cancelHide = useCallback(() => { clearTimeout(timer.current); }, []);
  const clearDrag = useCallback(() => {
    clearTimeout(longPress.current);
    const pending = drag.current;
    drag.current = null;
    if (pending?.moved) onDragPreview(null);
    setDrop(null);
    if (pending) pending.element.style.touchAction = '';
    if (pending?.element.hasPointerCapture?.(pending.pointerId)) pending.element.releasePointerCapture(pending.pointerId);
  }, [onDragPreview]);
  const close = useCallback(() => { cancelHide(); clearDrag(); pinned.current = false; setPinned(false); setOpen(null); }, [cancelHide, clearDrag]);
  const hideSoon = useCallback(() => {
    cancelHide();
    if (!pinned.current && !drag.current) timer.current = setTimeout(close, 300);
  }, [cancelHide, close]);
  const closeUnlessPinned = useCallback(() => { if (!pinned.current) close(); }, [close]);
  useImperativeHandle(ref, () => ({
    show: (bar, anchor, fixed = false) => {
      if (pinned.current && !fixed) return;
      cancelHide(); clearDrag(); pinned.current = fixed; setPinned(fixed); setOpen({ itemId: bar.item.itemId, anchor });
    }, hideSoon, close, closeUnlessPinned, isPinned: () => pinned.current
  }), [cancelHide, clearDrag, hideSoon, close, closeUnlessPinned]);
  const openBar = open && [...(layout.forwardQueue ?? []), ...layout.groups.flatMap((group) => group.rows.flatMap((row) => row.bars))]
    .find((bar) => bar.item.itemId === open.itemId);
  useEffect(() => { closeUnlessPinned(); }, [layout, scale, closeUnlessPinned]);
  useEffect(() => { if (open && !openBar) close(); }, [open, openBar, close]);
  useEffect(() => { clearDrag(); }, [layout, disabled, dragDisabled, resourceView, clearDrag]);
  useEffect(() => () => { clearTimeout(timer.current); clearDrag(); }, [clearDrag]);
  useEffect(() => {
    if (!open) return;
    const outside = (event: globalThis.PointerEvent) => {
      if (event.target instanceof Node && !panel.current?.contains(event.target) && (!open.anchor.contains(event.target) || pinned.current)) close();
    };
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') close(); };
    document.addEventListener('pointerdown', outside);
    document.addEventListener('keydown', escape);
    window.addEventListener('resize', closeUnlessPinned);
    window.addEventListener('blur', clearDrag);
    return () => {
      document.removeEventListener('pointerdown', outside);
      document.removeEventListener('keydown', escape);
      window.removeEventListener('resize', closeUnlessPinned);
      window.removeEventListener('blur', clearDrag);
    };
  }, [open, close, closeUnlessPinned, clearDrag]);
  useEffect(() => {
    const element = panel.current;
    if (!open || !element) return;
    const preventScroll = (event: TouchEvent) => { if (drag.current?.ready) event.preventDefault(); };
    element.addEventListener('touchmove', preventScroll, { passive: false });
    return () => element.removeEventListener('touchmove', preventScroll);
  }, [open]);
  useLayoutEffect(() => {
    if (!open || !panel.current) return;
    const anchor = open.anchor.getBoundingClientRect();
    const rect = panel.current.getBoundingClientRect();
    const zoom = pageZoom();
    setPosition({ left: Math.max(8, Math.min(anchor.left / zoom - 40, (window.innerWidth - rect.width) / zoom - 8)),
      top: Math.max(8, Math.min(anchor.bottom / zoom + 8, (window.innerHeight - rect.height) / zoom - 8)) });
    const card = scroll.current?.querySelector<HTMLElement>(`[data-testid="planning-forward-queue-card-${open.itemId}"]`);
    if (scroll.current && card) scroll.current.scrollLeft = Math.max(0, card.offsetLeft - 160);
  }, [open]);
  if (!open || !openBar) return null;
  const cards = forwardQueueWindow(layout, openBar);
  // The drop target can vanish in a refresh before the drag is cleared, so look it up once and tolerate a miss.
  const dropCard = drop ? cards.find((entry) => entry.bar.item.itemId === drop.bar.item.itemId) : undefined;
  const gapFrom = drop && dropCard ? dropCard.position + (drop.placement === 'after' ? 1 : 0) : null;
  const findDrop = (clientX: number, source: GanttBar): Drop | null => {
    const others = cards.filter(({ bar }) => bar.item.itemId !== source.item.itemId).map(({ bar, position: queuePosition }) => ({ bar,
      rect: panel.current?.querySelector<HTMLElement>(`[data-queue-position="${queuePosition}"]`)?.getBoundingClientRect()
    })).filter((entry) => entry.rect);
    const before = others.find(({ rect }) => clientX < rect!.left + rect!.width / 2);
    const target = before ?? others[others.length - 1];
    return target && canReorderForwardBars(source, target.bar) ? { bar: target.bar, placement: before ? 'before' : 'after' } : null;
  };
  const move = (event: PointerEvent<HTMLDivElement>) => {
    const pending = drag.current;
    if (!pending || pending.pointerId !== event.pointerId) return null;
    const distance = Math.hypot(event.clientX - pending.x, event.clientY - pending.y);
    if (!pending.ready) {
      if (distance > 0) clearDrag();
      return null;
    }
    if (distance >= 8) pending.moved = true;
    if (!pending.moved) return null;
    const rect = panel.current?.getBoundingClientRect();
    const hits = document.elementsFromPoint?.(event.clientX, event.clientY) ?? [];
    const inside = hits.some((element) => panel.current?.contains(element)) || Boolean(rect && rect.width > 0 &&
      event.clientX >= rect.left && event.clientX <= rect.right && event.clientY >= rect.top && event.clientY <= rect.bottom);
    const inQueue = inside;
    const next = inQueue ? findDrop(event.clientX, pending.bar) : null;
    setDrop(next);
    const ganttDrop = inQueue ? null : findForwardDrop(event.clientX, event.clientY, pending.bar, pending.allowed,
      viewport.current?.closest('[data-testid="planning-board-gantt"]'), lanes, start, dayWidth);
    onDragPreview({ source: 'queue', bar: pending.bar, x: event.clientX, y: event.clientY, allowed: pending.allowed, drop: ganttDrop });
    return { queue: next, gantt: ganttDrop };
  };
  const isVisible = (bar: GanttBar) => {
    if (bar.start == null || bar.end == null) return false;
    const segments = bar.unknown ? [{ start: bar.start, end: bar.start + 70 / dayWidth }] : bar.segments ?? [{ start: bar.start, end: bar.end }];
    return segments.some((segment) => (segment.start - start) * dayWidth < visibleRange.right && (segment.end - start) * dayWidth > visibleRange.left);
  };
  const resourceLabel = ganttResourceLabel(openBar.resource, resourceNameMap[openBar.resource]);
  return createPortal(<div ref={panel} data-forward-queue data-pinned={isPinned} role="region" aria-label={`${resourceLabel} の次にやる順`}
    className={clsx(isPinned ? 'border-2 border-amber-400' : 'border border-slate-600', 'fixed z-[100] max-h-[calc(100dvh-16px)] max-w-[calc(100vw-16px)] overflow-auto rounded-lg bg-slate-900 p-2 text-slate-100 shadow-xl')}
    style={position} onPointerEnter={pin} onPointerLeave={(event) => { if (event.pointerType === 'mouse') hideSoon(); }}>
    <div ref={scroll} className="relative flex gap-1.5 overflow-x-auto p-1">
      {cards.map(({ bar, position: queuePosition }) => <div key={bar.item.itemId} data-queue-position={queuePosition}
        data-testid={`planning-forward-queue-card-${bar.item.itemId}`}
        className={clsx('relative min-h-11 w-[150px] shrink-0 touch-pan-x select-none rounded-lg border-l-[5px] bg-slate-950 p-2 text-xs tabular-nums',
          bar.arrivalPending ? 'border-slate-600 text-slate-500 [&_.text-slate-400]:text-slate-600' : bar.tone === 'late' ? 'border-rose-400' : 'border-sky-400',
          bar.item.itemId === openBar.item.itemId && 'outline outline-2 outline-amber-400',
          draggedItemId === bar.item.itemId && 'outline outline-2 outline-dashed outline-amber-400 [&>*]:opacity-30')}
        data-viewport-visible={isVisible(bar) || undefined}
        style={{ borderTop: isVisible(bar) ? '3px solid rgb(251 191 36)' : undefined,
          transform: gapFrom !== null && queuePosition >= gapFrom ? 'translateX(10px)' : undefined, transition: 'transform 120ms' }}
        onPointerDown={(event) => {
          if (event.button !== 0 || event.isPrimary === false || drag.current || disabled || dragDisabled || !resourceView || bar.item.isCompleted || bar.arrivalPending || (event.target instanceof Element && event.target.closest('button'))) return;
          cancelHide();
          const element = event.currentTarget;
          drag.current = { bar, x: event.clientX, y: event.clientY, pointerId: event.pointerId, element, moved: false, ready: event.pointerType !== 'touch',
            allowed: new Set(lanes.filter((lane) => lane.resource === bar.resource || canMoveResource?.(bar.item, lane.resource)).map((lane) => lane.resource)) };
          if (event.pointerType === 'touch') longPress.current = setTimeout(() => {
            if (!drag.current) return;
            drag.current.ready = true;
            drag.current.moved = true;
            onDragPreview({ source: 'queue', bar, x: drag.current.x, y: drag.current.y, allowed: drag.current.allowed, drop: null });
            element.setPointerCapture?.(event.pointerId);
            element.style.touchAction = 'none';
          }, 220);
          else element.setPointerCapture?.(event.pointerId);
        }} onPointerMove={move} onPointerUp={(event) => {
          const pending = drag.current;
          if (!pending || pending.pointerId !== event.pointerId) return;
          const target = move(event);
          clearDrag();
          if (target?.queue) onResourceReorder?.(pending.bar.item, target.queue.bar.item, target.queue.placement);
          if (target?.gantt) {
            const destination = target.gantt;
            if (destination.resource !== pending.bar.resource) onResourceMove?.(pending.bar.item, destination.resource, destination.bar?.item ?? null, destination.placement);
            else if (destination.bar) onResourceReorder?.(pending.bar.item, destination.bar.item, destination.placement);
          }
          const rect = panel.current?.getBoundingClientRect();
          if (rect && (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom)) hideSoon();
        }} onPointerCancel={() => { clearDrag(); hideSoon(); }} onLostPointerCapture={() => { if (drag.current) { clearDrag(); hideSoon(); } }}>
        <div className="truncate text-slate-400">{[bar.item.fseiban, bar.unknown ? '所要不明' : formatPlanningBoardItemMinutes(bar.item)].filter((part) => part !== '').join(' · ')}</div>
        <strong className="my-0.5 block truncate text-sm" title={bar.item.fhinmei || bar.item.fhincd}>{bar.item.fhinmei || bar.item.fhincd}</strong>
        <div className="truncate text-slate-400">{[bar.item.fhincd, bar.item.kind === 'piece' ? `${bar.item.quantity ?? '—'}／${bar.item.parentPlannedQuantity ?? '—'}` : bar.item.plannedQuantity == null ? null : `${bar.item.plannedQuantity}個`].filter((part) => part != null && part !== '').join(' · ')}</div>
        <div className="truncate text-slate-400">{normalizeMachineName(bar.item.machineName)}</div>
        {!bar.arrivalPending && forwardStartLabel(bar) && <div className="truncate text-slate-400">開始 {forwardStartLabel(bar)}</div>}
        {bar.due && <div className={clsx('truncate', !bar.arrivalPending && bar.tone === 'late' ? 'text-rose-300' : 'text-slate-400')}>納期 {forwardDueLabel(bar.due)}</div>}
        {bar.item.isFirstProcess ? (
          <div className="mt-1 grid grid-cols-2 gap-1">
            {(['arrived', 'excluded'] as const).map((state) => <button key={state} type="button"
              aria-pressed={bar.item.firstProcessState === state}
              className={clsx('min-h-9 rounded border border-slate-500 disabled:opacity-50',
                bar.item.firstProcessState === state ? 'bg-white text-slate-950' : 'text-slate-100')}
              disabled={disabled || arrivalPending}
              onClick={() => onFirstProcessArrivalChange?.(bar.item, bar.item.firstProcessState === state ? null : state)}>
              {state === 'arrived' ? '着' : '外'}
            </button>)}
          </div>
        ) : bar.arrivalPending ? (
          <button type="button" className="mt-1 min-h-9 w-full rounded border border-slate-500 text-slate-100 disabled:opacity-50"
            disabled={disabled || arrivalPending} onClick={() => onArrivalChange?.(bar.item, true)}>着</button>
        ) : <>
          {bar.item.manualArrivalDate && <button type="button" className="mt-1 min-h-9 w-full rounded border border-slate-500 text-slate-100 disabled:opacity-50"
            disabled={disabled || arrivalPending} onClick={() => onArrivalChange?.(bar.item, false)}>取り消し</button>}
        </>}

        {drop?.bar.item.itemId === bar.item.itemId && <span data-testid="planning-forward-queue-insertion"
          className={clsx('pointer-events-none absolute inset-y-0 w-1 bg-emerald-300', drop.placement === 'before' ? '-left-1.5' : '-right-1')} />}
      </div>)}
    </div>
    {arrivalError && <div role="alert" className="px-1 text-xs text-rose-300">着の更新に失敗しました。</div>}
  </div>, document.body);
});
