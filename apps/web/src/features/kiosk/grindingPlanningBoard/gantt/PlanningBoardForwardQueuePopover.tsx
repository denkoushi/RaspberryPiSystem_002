import clsx from 'clsx';
import { forwardRef, useCallback, useEffect, useImperativeHandle, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

import { normalizeMachineName } from '../../productionSchedule/machineName';
import { usePlanningBoardOffline } from '../offline/PlanningBoardOfflineProvider';
import { pageZoom } from '../pageZoom';
import { formatPlanningBoardItemMinutes } from '../planningBoardLoad';

import { ganttResourceLabel } from './ganttResourceLabel';
import { findForwardDrop, forwardDropBoard } from './planningBoardForwardDrop';
import { canReorderForwardBars, forwardDueLabel, forwardQueueWindow, forwardStartLabel } from './planningBoardForwardQueue';

import type { ForwardDragPreview, ForwardMove, ForwardReorder } from './PlanningBoardForwardGanttRow';
import type { GanttBar, GanttLayout } from './planningBoardGanttLayout';
import type { ForwardDragLane } from './planningBoardSingleResourceWindows';
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
  folded?: boolean;
  viewport: RefObject<HTMLDivElement | null>;
  lanes: { readonly current: readonly ForwardDragLane[] };
  start: number;
  dayWidth: number;
  focusedSeiban?: string | null;
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
  viewport, lanes, start, dayWidth, focusedSeiban = null, onDragPreview, draggedItemId, onResourceMove, canMoveResource,
  layout, scale, resourceNameMap, disabled, dragDisabled, resourceView, onResourceReorder, onArrivalChange, onFirstProcessArrivalChange, arrivalPending, arrivalError
}, ref) {
  const { gate, frozen } = usePlanningBoardOffline();
  const [open, setOpen] = useState<OpenQueue | null>(null);
  const pinned = useRef(false);
  const [isPinned, setPinned] = useState(false);
  const pin = () => { pinned.current = true; setPinned(true); cancelHide(); };
  const scroll = useRef<HTMLDivElement>(null);
  const longPress = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const [position, setPosition] = useState({ left: 8, top: 8 });
  const [drop, setDrop] = useState<Drop | null>(null);
  const panel = useRef<HTMLDivElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const drag = useRef<Drag | null>(null);
  const dragPointer = useRef({ x: 0, y: 0 });
  const [autoScrolling, setAutoScrolling] = useState(false);
  const cancelHide = useCallback(() => { clearTimeout(timer.current); }, []);
  const clearDrag = useCallback(() => {
    clearTimeout(longPress.current);
    const pending = drag.current;
    drag.current = null;
    setAutoScrolling(false);
    if (pending?.ready) onDragPreview(null);
    setDrop(null);
    if (pending) pending.element.style.touchAction = '';
    if (pending?.element.hasPointerCapture?.(pending.pointerId)) pending.element.releasePointerCapture(pending.pointerId);
  }, [onDragPreview]);
  useEffect(() => gate.subscribeReadOnly(clearDrag), [clearDrag, gate]);
  useEffect(() => { if (frozen) clearDrag(); }, [clearDrag, frozen]);
  const close = useCallback(() => { cancelHide(); clearDrag(); pinned.current = false; setPinned(false); setOpen(null); }, [cancelHide, clearDrag]);
  const hideSoon = useCallback(() => {
    cancelHide();
    if (!pinned.current && !drag.current) timer.current = setTimeout(close, 300);
  }, [cancelHide, close]);
  const closeUnlessPinned = useCallback(() => { if (!pinned.current && !drag.current) close(); }, [close]);
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
  useEffect(() => { clearDrag(); }, [disabled, dragDisabled, resourceView, clearDrag]);
  useEffect(() => {
    const pending = drag.current;
    if (!pending) return;
    const bar = [...(layout.forwardQueue ?? []), ...layout.groups.flatMap((group) => group.rows.flatMap((row) => row.bars))]
      .find((candidate) => candidate.item.itemId === pending.bar.item.itemId);
    if (!bar || bar.arrivalPending !== pending.bar.arrivalPending || bar.item.isCompleted !== pending.bar.item.isCompleted || bar.resource !== pending.bar.resource) clearDrag();
    else pending.bar = bar;
  }, [layout, clearDrag]);
  useEffect(() => () => { clearTimeout(timer.current); clearDrag(); }, [clearDrag]);
  useEffect(() => {
    if (!open) return;
    const outside = (event: globalThis.PointerEvent) => {
      if (event.target instanceof Node && !panel.current?.contains(event.target) && (!open.anchor.contains(event.target) || pinned.current)) close();
    };
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape' && !document.querySelector('[role="dialog"]')) { event.preventDefault(); close(); } };
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
  const findDrop = useCallback((clientX: number, source: GanttBar): Drop | null => {
    const cards = openBar ? forwardQueueWindow(layout, openBar) : [];
    const others = cards.filter(({ bar }) => bar.item.itemId !== source.item.itemId).map(({ bar, position: queuePosition }) => ({ bar,
      rect: panel.current?.querySelector<HTMLElement>(`[data-queue-position="${queuePosition}"]`)?.getBoundingClientRect()
    })).filter((entry) => entry.rect);
    const before = others.find(({ rect }) => clientX < rect!.left + rect!.width / 2);
    const target = before ?? others[others.length - 1];
    return target && canReorderForwardBars(source, target.bar) ? { bar: target.bar, placement: before ? 'before' : 'after' } : null;
  }, [layout, openBar]);
  useEffect(() => {
    if (!autoScrolling) return;
    let frame: number;
    const tick = () => {
      const pending = drag.current;
      if (!pending?.moved) return;
      const element = scroll.current;
      const bounds = panel.current?.getBoundingClientRect();
      const { x, y } = dragPointer.current;
      if (element && bounds && x >= bounds.left && x <= bounds.right && y >= bounds.top && y <= bounds.bottom) {
        const strip = element.getBoundingClientRect();
        const distance = x <= strip.left + 64 ? x - strip.left : x >= strip.right - 64 ? strip.right - x : null;
        const delta = distance === null ? 0 : (x <= strip.left + 64 ? -1 : 1) * (2 + 22 * (1 - Math.max(0, distance) / 64));
        if (delta) {
          const previous = element.scrollLeft;
          element.scrollLeft += delta;
          if (element.scrollLeft !== previous) {
            setDrop(findDrop(x, pending.bar));
            onDragPreview({ source: 'queue', bar: pending.bar, x, y, allowed: pending.allowed, drop: null });
          }
        }
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [autoScrolling, findDrop, onDragPreview]);
  if (!open || !openBar) return null;
  const cards = forwardQueueWindow(layout, openBar);
  const move = (event: PointerEvent<HTMLDivElement>) => {
    const pending = drag.current;
    if (!pending || pending.pointerId !== event.pointerId) return null;
    dragPointer.current = { x: event.clientX, y: event.clientY };
    const distance = Math.hypot(event.clientX - pending.x, event.clientY - pending.y);
    if (!pending.ready) {
      if (distance > 0) clearDrag();
      return null;
    }
    if (distance >= 8) { pending.moved = true; setAutoScrolling(true); }
    if (!pending.moved) return null;
    const rect = panel.current?.getBoundingClientRect();
    const hits = document.elementsFromPoint?.(event.clientX, event.clientY) ?? [];
    const inside = hits.some((element) => panel.current?.contains(element)) || Boolean(rect && rect.width > 0 &&
      event.clientX >= rect.left && event.clientX <= rect.right && event.clientY >= rect.top && event.clientY <= rect.bottom);
    const inQueue = inside;
    const next = inQueue ? findDrop(event.clientX, pending.bar) : null;
    setDrop(next);
    const ganttDrop = inQueue ? null : findForwardDrop(event.clientX, event.clientY, pending.bar, pending.allowed,
      forwardDropBoard(viewport.current), lanes.current, start, dayWidth);
    onDragPreview({ source: 'queue', bar: pending.bar, x: event.clientX, y: event.clientY, allowed: pending.allowed, drop: ganttDrop });
    return { queue: next, gantt: ganttDrop };
  };
  const resourceLabel = ganttResourceLabel(openBar.resource, resourceNameMap[openBar.resource]);
  return createPortal(<div ref={panel} data-forward-queue data-pinned={isPinned} role="region" aria-label={`${resourceLabel} の次にやる順`}
    className={clsx(isPinned ? 'border-2 border-amber-400' : 'border border-slate-600', 'fixed z-[100] max-h-[calc(100dvh-16px)] max-w-[calc(100vw-16px)] overflow-auto rounded-lg bg-slate-900 p-2 text-slate-100 shadow-xl')}
    style={position} onPointerEnter={pin} onPointerLeave={(event) => { if (event.pointerType === 'mouse') hideSoon(); }}>
    <div ref={scroll} className="relative flex gap-1.5 overflow-x-auto p-1">
      {cards.map(({ bar, position: queuePosition }) => { const item = bar.item; return <div key={item.itemId} data-queue-position={queuePosition}
        data-testid={`planning-forward-queue-card-${item.itemId}`}
        className={clsx('relative min-h-11 w-[150px] shrink-0 touch-pan-x select-none rounded-lg border-l-[5px] border-slate-950 bg-slate-950 p-2 text-xs tabular-nums',
          bar.arrivalPending && 'text-slate-500 [&_.text-slate-400]:text-slate-600',
          focusedSeiban !== null && item.kind !== 'test' && item.fseiban === focusedSeiban && 'shadow-[0_0_0_3px_#fff]',
          item.itemId === openBar.item.itemId && clsx('outline outline-2 outline-amber-400', focusedSeiban !== null && item.kind !== 'test' && item.fseiban === focusedSeiban && 'outline-offset-[-3px]'),
          draggedItemId === item.itemId && 'outline outline-2 outline-dashed outline-amber-400 [&>*]:opacity-30')}
        onPointerDown={(event) => {
          if (event.button !== 0 || event.isPrimary === false || drag.current || disabled || dragDisabled || !resourceView || item.isCompleted || bar.arrivalPending || (event.target instanceof Element && event.target.closest('button'))) return;
          if (!gate.attempt()) return;
          cancelHide();
          const element = event.currentTarget;
          drag.current = { bar, x: event.clientX, y: event.clientY, pointerId: event.pointerId, element, moved: false, ready: event.pointerType !== 'touch',
            allowed: new Set(lanes.current.filter((lane) => lane.resource === bar.resource || (item.kind !== 'test' && canMoveResource?.(item, lane.resource))).map((lane) => lane.resource)) };
          dragPointer.current = { x: event.clientX, y: event.clientY };
          if (event.pointerType === 'touch') longPress.current = setTimeout(() => {
            if (!drag.current) return;
            drag.current.ready = true;
            onDragPreview({ source: 'queue', bar: drag.current.bar, x: drag.current.x, y: drag.current.y, allowed: drag.current.allowed, drop: null });
            element.setPointerCapture?.(event.pointerId);
            element.style.touchAction = 'none';
          }, 220);
          else element.setPointerCapture?.(event.pointerId);
        }} onPointerMove={move} onPointerUp={(event) => {
          const pending = drag.current;
          if (!pending || pending.pointerId !== event.pointerId) return;
          const target = move(event);
          clearDrag();
          if (target && !gate.attempt()) return;
          if (target?.queue) onResourceReorder?.(pending.bar.item, target.queue.bar.item, target.queue.placement);
          if (target?.gantt) {
            const destination = target.gantt;
            if (destination.resource !== pending.bar.resource && pending.bar.item.kind !== 'test' && destination.bar?.item.kind !== 'test') onResourceMove?.(pending.bar.item, destination.resource, destination.bar?.item ?? null, destination.placement);
            else if (destination.bar) onResourceReorder?.(pending.bar.item, destination.bar.item, destination.placement);
          }
          const rect = panel.current?.getBoundingClientRect();
          if (rect && (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom)) hideSoon();
        }} onPointerCancel={() => { clearDrag(); hideSoon(); }} onLostPointerCapture={() => { if (drag.current) { clearDrag(); hideSoon(); } }}>
        {item.kind === 'test' ? <><strong className="block text-sm text-violet-300">{item.name}</strong><div>{item.minutes}分</div></> : <>
        <div className="truncate text-slate-400">{[item.fseiban, bar.unknown ? '所要不明' : formatPlanningBoardItemMinutes(item)].filter((part) => part !== '').join(' · ')}</div>
        <strong className="my-0.5 block truncate text-sm" title={item.fhinmei || item.fhincd}>{item.fhinmei || item.fhincd}</strong>
        <div className="truncate text-slate-400">{[item.fhincd, item.kind === 'piece' ? `${item.quantity ?? '—'}／${item.parentPlannedQuantity ?? '—'}` : item.plannedQuantity == null ? null : `${item.plannedQuantity}個`].filter((part) => part != null && part !== '').join(' · ')}</div>
        <div className="truncate text-slate-400">{normalizeMachineName(item.machineName)}</div>
        {!bar.arrivalPending && forwardStartLabel(bar) && <div className="truncate text-slate-400">開始 {forwardStartLabel(bar)}</div>}
        {bar.due && <div className={clsx('truncate', !bar.arrivalPending && bar.tone === 'late' ? 'text-rose-300' : 'text-slate-400')}>納期 {forwardDueLabel(bar.due)}</div>}
        {item.isFirstProcess ? (
          <div className="mt-1 grid grid-cols-2 gap-1">
            {(['arrived', 'excluded'] as const).map((state) => <button key={state} type="button"
              aria-pressed={item.firstProcessState === state}
              className={clsx('min-h-9 rounded border border-slate-500 disabled:opacity-50',
                item.firstProcessState === state ? 'bg-white text-slate-950' : 'text-slate-100')}
              disabled={disabled || arrivalPending}
              onClick={() => onFirstProcessArrivalChange?.(item, item.firstProcessState === state ? null : state)}>
              {state === 'arrived' ? '着' : '外'}
            </button>)}
          </div>
        ) : bar.arrivalPending ? (
          <button type="button" className="mt-1 min-h-9 w-full rounded border border-slate-500 text-slate-100 disabled:opacity-50"
            disabled={disabled || arrivalPending} onClick={() => onArrivalChange?.(item, true)}>着</button>
        ) : <>
          {item.manualArrivalDate && <button type="button" className="mt-1 min-h-9 w-full rounded border border-slate-500 text-slate-100 disabled:opacity-50"
            disabled={disabled || arrivalPending} onClick={() => onArrivalChange?.(item, false)}>取り消し</button>}
        </>}

        </>}
        {drop?.bar.item.itemId === item.itemId && <span data-testid="planning-forward-queue-insertion"
          className={clsx('pointer-events-none absolute inset-y-0 w-1 bg-emerald-300', drop.placement === 'before' ? '-left-1.5' : '-right-1')} />}
      </div>; })}
    </div>
    {arrivalError && <div role="alert" className="px-1 text-xs text-rose-300">着の更新に失敗しました。</div>}
  </div>, document.body);
});
