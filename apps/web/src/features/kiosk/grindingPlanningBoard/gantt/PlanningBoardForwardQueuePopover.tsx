import clsx from 'clsx';
import { forwardRef, useCallback, useEffect, useImperativeHandle, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

import { normalizeMachineName } from '../../productionSchedule/machineName';

import { canReorderForwardBars, forwardQueueWindow } from './planningBoardForwardQueue';

import type { ForwardReorder } from './PlanningBoardForwardGanttRow';
import type { GanttBar, GanttLayout } from './planningBoardGanttLayout';
import type { GrindingPlanningBoardResourceOrderPlacement } from '@raspi-system/shared-types';
import type { PointerEvent } from 'react';

type OpenQueue = { bar: GanttBar; anchor: HTMLButtonElement };
type Drop = { bar: GanttBar; placement: GrindingPlanningBoardResourceOrderPlacement };
type Drag = { bar: GanttBar; x: number; pointerId: number; element: HTMLDivElement; moved: boolean };
export type ForwardQueueHandle = {
  show: (bar: GanttBar, anchor: HTMLButtonElement) => void;
  hideSoon: () => void;
  close: () => void;
};
type Props = {
  layout: GanttLayout;
  scale: number;
  resourceNameMap: Record<string, string[]>;
  disabled: boolean;
  dragDisabled: boolean;
  resourceView: boolean;
  onResourceReorder?: ForwardReorder;
};

export const PlanningBoardForwardQueuePopover = forwardRef<ForwardQueueHandle, Props>(function PlanningBoardForwardQueuePopover({
  layout, scale, resourceNameMap, disabled, dragDisabled, resourceView, onResourceReorder
}, ref) {
  const [open, setOpen] = useState<OpenQueue | null>(null);
  const [position, setPosition] = useState({ left: 8, top: 8 });
  const [drop, setDrop] = useState<Drop | null>(null);
  const panel = useRef<HTMLDivElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>();
  const drag = useRef<Drag | null>(null);
  const cancelHide = useCallback(() => { clearTimeout(timer.current); }, []);
  const clearDrag = useCallback(() => {
    const pending = drag.current;
    drag.current = null;
    setDrop(null);
    if (pending?.element.hasPointerCapture?.(pending.pointerId)) pending.element.releasePointerCapture(pending.pointerId);
  }, []);
  const close = useCallback(() => { cancelHide(); clearDrag(); setOpen(null); }, [cancelHide, clearDrag]);
  const hideSoon = useCallback(() => {
    cancelHide();
    if (!drag.current) timer.current = setTimeout(close, 300);
  }, [cancelHide, close]);
  useImperativeHandle(ref, () => ({
    show: (bar, anchor) => { cancelHide(); clearDrag(); setOpen({ bar, anchor }); }, hideSoon, close
  }), [cancelHide, clearDrag, hideSoon, close]);
  useEffect(() => { close(); }, [layout, scale, close]);
  useEffect(() => { clearDrag(); }, [disabled, dragDisabled, resourceView, clearDrag]);
  useEffect(() => () => { clearTimeout(timer.current); }, []);
  useEffect(() => {
    if (!open) return;
    const outside = (event: globalThis.PointerEvent) => {
      if (event.target instanceof Node && !panel.current?.contains(event.target) && !open.anchor.contains(event.target)) close();
    };
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') close(); };
    document.addEventListener('pointerdown', outside);
    document.addEventListener('keydown', escape);
    window.addEventListener('resize', close);
    window.addEventListener('blur', close);
    return () => {
      document.removeEventListener('pointerdown', outside);
      document.removeEventListener('keydown', escape);
      window.removeEventListener('resize', close);
      window.removeEventListener('blur', close);
    };
  }, [open, close]);
  useLayoutEffect(() => {
    if (!open || !panel.current) return;
    const anchor = open.anchor.getBoundingClientRect();
    const rect = panel.current.getBoundingClientRect();
    setPosition({ left: Math.max(8, Math.min(anchor.left - 40, window.innerWidth - rect.width - 8)),
      top: Math.max(8, Math.min(anchor.bottom + 8, window.innerHeight - rect.height - 8)) });
  }, [open]);
  if (!open) return null;
  const cards = forwardQueueWindow(layout, open.bar);
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
    if (Math.abs(event.clientX - pending.x) >= 8) pending.moved = true;
    const next = pending.moved && !disabled && !dragDisabled && resourceView ? findDrop(event.clientX, pending.bar) : null;
    setDrop(next);
    return next;
  };
  const resourceLabel = [open.bar.resource, ...(resourceNameMap[open.bar.resource] ?? [])].join(' ');
  return createPortal(<div ref={panel} role="region" aria-label={`${resourceLabel} の次にやる順`}
    className="fixed z-[100] max-h-[calc(100dvh-16px)] max-w-[calc(100vw-16px)] overflow-auto rounded-lg border border-slate-600 bg-slate-900 p-2 text-slate-100 shadow-xl"
    style={position} onPointerEnter={cancelHide} onPointerLeave={(event) => { if (event.pointerType === 'mouse') hideSoon(); }}>
    <div className="flex gap-1.5 overflow-x-auto p-1">
      {cards.map(({ bar, position: queuePosition }) => <div key={bar.item.itemId} data-queue-position={queuePosition}
        data-testid={`planning-forward-queue-card-${bar.item.itemId}`}
        className={clsx('relative min-h-11 w-[150px] shrink-0 touch-pan-y select-none rounded-lg border-l-[5px] bg-slate-950 p-2 text-xs tabular-nums',
          bar.tone === 'late' ? 'border-rose-400' : 'border-sky-400',
          bar.item.itemId === open.bar.item.itemId && 'outline outline-2 outline-amber-400')}
        onPointerDown={(event) => {
          if (event.button !== 0 || event.isPrimary === false || drag.current || disabled || dragDisabled || !resourceView || bar.item.isCompleted) return;
          cancelHide();
          drag.current = { bar, x: event.clientX, pointerId: event.pointerId, element: event.currentTarget, moved: false };
          event.currentTarget.setPointerCapture?.(event.pointerId);
        }} onPointerMove={move} onPointerUp={(event) => {
          const pending = drag.current;
          if (!pending || pending.pointerId !== event.pointerId) return;
          const target = move(event);
          clearDrag();
          if (target) onResourceReorder?.(pending.bar.item, target.bar.item, target.placement);
          const rect = panel.current?.getBoundingClientRect();
          if (rect && (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom)) hideSoon();
        }} onPointerCancel={() => { clearDrag(); hideSoon(); }} onLostPointerCapture={() => { if (drag.current) { clearDrag(); hideSoon(); } }}>
        <div className="truncate text-slate-400">{[bar.item.fseiban, bar.unknown ? '所要不明' : `${bar.item.requiredMinutes}分`, bar.item.plannedQuantity == null ? null : `${bar.item.plannedQuantity}個`].filter((part) => part != null && part !== '').join(' · ')}</div>
        <strong className="my-0.5 block truncate text-sm" title={bar.item.fhinmei || bar.item.fhincd}>{bar.item.fhinmei || bar.item.fhincd}</strong>
        <div className="truncate text-slate-400">{bar.item.fhincd}</div>
        <div className="truncate text-slate-400">{normalizeMachineName(bar.item.machineName)}</div>
        {drop?.bar.item.itemId === bar.item.itemId && <span data-testid="planning-forward-queue-insertion"
          className={clsx('pointer-events-none absolute inset-y-0 w-0.5 bg-white', drop.placement === 'before' ? '-left-1.5' : '-right-1')} />}
      </div>)}
    </div>
  </div>, document.body);
});
