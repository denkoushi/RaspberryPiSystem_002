import clsx from 'clsx';
import { useEffect, useMemo, useRef, useState } from 'react';

import { canReorderForwardBars, forwardItemDetails } from './planningBoardForwardQueue';
import { dateToDay, workingPeriods } from './planningBoardGanttLayout';
import { GANTT_FORWARD_LABEL_WIDTH } from './PlanningBoardGanttRow';

import type { GanttBar, GanttRow } from './planningBoardGanttLayout';
import type { GrindingPlanningBoardItem, GrindingPlanningBoardResourceOrderPlacement } from '@raspi-system/shared-types';
import type { PointerEvent, ReactNode } from 'react';

export type ForwardReorder = (item: GrindingPlanningBoardItem, target: GrindingPlanningBoardItem, placement: GrindingPlanningBoardResourceOrderPlacement) => void;
type Drop = { bar: GanttBar; placement: GrindingPlanningBoardResourceOrderPlacement; left: number };
type Drag = { bar: GanttBar; x: number; y: number; tapCancelled: boolean; longPressed: boolean; selected: boolean; pointerId: number; element: HTMLButtonElement; moved: boolean };
type Props = {
  row: GanttRow;
  label?: ReactNode;
  start: number;
  end: number;
  now: number;
  width: number;
  dayWidth: number;
  scale: number;
  onShowQueue: (bar: GanttBar, anchor: HTMLButtonElement) => void;
  onLeaveQueue: () => void;
  onCloseQueue: () => void;
  hours: number;
  selectedItemIds: ReadonlySet<string>;
  disabled: boolean;
  dragDisabled: boolean;
  resourceView: boolean;
  onToggleItem: (item: GrindingPlanningBoardItem, selected: boolean) => void;
  onResourceReorder?: ForwardReorder;
  focusedPartKey: string | null;
  chainPositions: ReadonlyMap<string, number>;
  onFocusChain: (bar: GanttBar) => void;
};

export function PlanningBoardForwardGanttRow({ row, label, start, end, now, width, dayWidth, hours, scale, onShowQueue, onLeaveQueue, onCloseQueue,
  selectedItemIds, disabled, dragDisabled, resourceView, onToggleItem, onResourceReorder, focusedPartKey, chainPositions, onFocusChain }: Props) {
  const track = useRef<HTMLDivElement>(null);
  const drag = useRef<Drag | null>(null);
  const suppressClick = useRef(false);
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cancelLongPress = () => {
    if (longPressTimer.current !== null) clearTimeout(longPressTimer.current);
    longPressTimer.current = null;
  };
  // Shade only the time before and after the working day; breaks still delay the bars but are not drawn.
  const offHours = useMemo(() => {
    const periods = workingPeriods(hours);
    return [{ start: 0, end: periods[0]!.start }, { start: periods[periods.length - 1]!.end, end: 1 }];
  }, [hours]);
  const [preview, setPreview] = useState<{ itemId: string; dx: number; drop: Drop | null } | null>(null);
  const clear = () => {
    cancelLongPress();
    const pending = drag.current;
    drag.current = null;
    setPreview(null);
    if (pending?.element.hasPointerCapture?.(pending.pointerId)) pending.element.releasePointerCapture(pending.pointerId);
  };
  useEffect(() => {
    const cancel = () => { cancelLongPress(); suppressClick.current = true; drag.current = null; setPreview(null); };
    window.addEventListener('blur', cancel);
    return () => { cancelLongPress(); window.removeEventListener('blur', cancel); };
  }, []);
  useEffect(() => { cancelLongPress(); if (drag.current) suppressClick.current = true; drag.current = null; setPreview(null); }, [row, dayWidth, disabled, dragDisabled]);
  const findDrop = (clientX: number, source: GanttBar): Drop | null => {
    const x = clientX - (track.current?.getBoundingClientRect().left ?? 0);
    const centre = (bar: GanttBar) => (bar.start! - start) * dayWidth +
      (bar.unknown ? 70 : Math.max(2, ((bar.segments?.[0]?.end ?? bar.end!) - bar.start!) * dayWidth - 2)) / 2;
    const others = row.bars.filter((bar) => bar.item.itemId !== source.item.itemId).sort((a, b) => centre(a) - centre(b));
    if (!others.length) return null;
    const target = others.find((bar) => x < centre(bar));
    const bar = target ?? others[others.length - 1]!;
    if (!canReorderForwardBars(source, bar)) return null;
    return { bar, placement: target ? 'before' : 'after', left: ((target ? bar.start! : bar.end!) - start) * dayWidth };
  };
  const move = (event: PointerEvent<HTMLButtonElement>) => {
    const pending = drag.current;
    if (!pending || pending.pointerId !== event.pointerId) return;
    const dx = event.clientX - pending.x;
    if (Math.hypot(dx, event.clientY - pending.y) >= 8) {
      pending.tapCancelled = true;
      cancelLongPress();
    }
    if (pending.longPressed) {
      if (Math.abs(dx) < 8) return;
      pending.longPressed = false;
      onToggleItem(pending.bar.item, pending.selected);
    }
    if (!pending.moved && Math.abs(dx) >= 8) { pending.moved = true; onCloseQueue(); }
    if (pending.moved && !disabled && !dragDisabled && resourceView) {
      setPreview({ itemId: pending.bar.item.itemId, dx, drop: findDrop(event.clientX, pending.bar) });
    }
  };
  return <div className="flex min-h-[76px] border-b border-slate-600" data-testid={`planning-forward-lane-${row.key}`}>
    <div className="sticky left-0 z-20 flex shrink-0 flex-col justify-center gap-1 border-r border-slate-700 bg-slate-900 px-2 py-1 text-xs" style={{ width: GANTT_FORWARD_LABEL_WIDTH }}>
      {label ?? <><strong className="truncate">{row.label}</strong><span className="truncate text-slate-400">{row.detail}</span></>}
    </div>
    <div ref={track} className="relative shrink-0 overflow-hidden" style={{ width }}>
      {hours < 24 && Array.from({ length: end - start }, (_, i) => <div key={i} className="pointer-events-none">
        {offHours.map((gap, index) => <span key={index} className="absolute inset-y-0 bg-slate-950/55"
          style={{ left: (i + gap.start) * dayWidth, width: (gap.end - gap.start) * dayWidth }} />)}
      </div>)}
      <span data-testid="planning-gantt-now" className="pointer-events-none absolute inset-y-0 z-[3] border-l-2 border-yellow-400" style={{ left: (now - start) * dayWidth }} />
      {row.connectors.map((link, i) => <span key={i} className="pointer-events-none absolute top-9 border-t-2 border-dotted border-amber-400" style={{ left: (link.start - start) * dayWidth, width: (link.end - link.start) * dayWidth }} />)}
      {row.bars.map((bar) => {
        const selected = selectedItemIds.has(bar.item.itemId);
        const inChain = focusedPartKey === bar.partKey;
        const segments = bar.unknown ? [{ start: bar.start!, end: bar.end! }] : bar.segments ?? [];
        return <div key={bar.item.itemId}>
          {segments.map((segment, index) => {
            const segmentWidth = bar.unknown ? 70 : Math.max(2, (segment.end - segment.start) * dayWidth - 2);
            return <button key={index} type="button" data-testid={`planning-gantt-bar-${bar.item.itemId}${index ? `-segment-${index}` : ''}`}
              data-gantt-late={bar.tone === 'late' && index === 0 ? 'true' : undefined}
              aria-label={`${bar.item.fhinmei || bar.item.fhincd} 工順${bar.item.processOrder} ${bar.resource} 納期${bar.due ?? 'なし'}`}
              aria-pressed={selected} disabled={disabled || bar.item.isCompleted}
              data-drag-disabled={dragDisabled || disabled || !resourceView}
              className={clsx('absolute top-[3px] h-[70px] touch-pan-y select-none rounded text-left text-[11px] font-bold leading-[14px] focus-visible:outline focus-visible:outline-2 focus-visible:outline-white',
                inChain && index === 0 ? 'overflow-visible' : 'overflow-hidden',
                bar.tone === 'late' ? 'bg-rose-400 text-slate-950' : 'bg-sky-400 text-slate-950',
                bar.unknown && 'border border-dashed border-slate-200 bg-slate-800 text-slate-200',
                inChain ? 'outline outline-2 outline-offset-1 outline-white' : selected && 'outline outline-2 outline-offset-1 outline-emerald-300',
                focusedPartKey !== null && !inChain && 'opacity-30', index > 0 && 'border-l-2 border-dashed border-slate-950')}
              style={{ left: (segment.start - start) * dayWidth, width: segmentWidth,
                transform: preview?.itemId === bar.item.itemId ? `translateX(${preview.dx}px)` : undefined,
                zIndex: preview?.itemId === bar.item.itemId ? 9 : inChain ? 8 : selected ? 4 : 2 }}
              onPointerEnter={(event) => { if (event.pointerType === 'mouse' && !drag.current) onShowQueue(bar, event.currentTarget); }}
              onPointerLeave={(event) => { if (event.pointerType === 'mouse') onLeaveQueue(); }}
              onPointerDown={(event) => {
                onCloseQueue();
                if (disabled || bar.item.isCompleted || event.button !== 0 || event.isPrimary === false || drag.current) return;
                suppressClick.current = false;
                drag.current = { bar, x: event.clientX, y: event.clientY, tapCancelled: false, longPressed: false, selected, pointerId: event.pointerId, element: event.currentTarget, moved: false };
                longPressTimer.current = setTimeout(() => {
                  const pending = drag.current;
                  if (!pending || pending.tapCancelled) return;
                  pending.longPressed = true;
                  suppressClick.current = true;
                  onToggleItem(bar.item, !selected);
                }, 500);
                event.currentTarget.setPointerCapture?.(event.pointerId);
              }} onPointerMove={move}
              onPointerUp={(event) => {
                const pending = drag.current;
                if (!pending || pending.pointerId !== event.pointerId) return;
                move(event);
                const drop = findDrop(event.clientX, pending.bar);
                suppressClick.current = pending.tapCancelled || pending.longPressed;
                clear();
                if (pending.moved && drop && !disabled && !dragDisabled && resourceView) onResourceReorder?.(pending.bar.item, drop.bar.item, drop.placement);
              }}
              onPointerCancel={() => { suppressClick.current = true; clear(); }}
              onLostPointerCapture={() => { if (drag.current) { suppressClick.current = true; clear(); } }}
              onClick={() => {
                if (suppressClick.current) { suppressClick.current = false; return; }
                onFocusChain(bar);
              }}>
              {inChain && index === 0 && <span data-testid={`planning-gantt-chain-badge-${bar.item.itemId}`} className="pointer-events-none absolute right-0 top-0 grid h-[22px] w-[22px] place-items-center rounded-full bg-slate-950 font-mono text-xs font-bold text-white">{chainPositions.get(bar.item.itemId)}</span>}
              {bar.unknown ? '所要不明' : segmentWidth >= 48
                ? <span className="block break-all px-1"><b className="line-clamp-2">{bar.item.fhinmei || bar.item.fhincd}</b>
                  <small className="line-clamp-3 text-[11px] font-normal">{scale <= 2 ? forwardItemDetails(bar.item) : `${bar.item.requiredMinutes}分`}</small>
                </span> : null}
            </button>;
          })}
          {selected && bar.due && <span data-testid={`planning-gantt-due-${bar.item.itemId}`} title={`納期 ${bar.due}`} className="pointer-events-none absolute bottom-0 -translate-x-1/2 text-xs leading-none text-rose-400"
            style={{ left: Math.max(0, (dateToDay(bar.due) + 1 - start) * dayWidth) }}>▲</span>}
        </div>;
      })}
      {preview?.drop && <span data-testid="planning-gantt-insertion" className="pointer-events-none absolute inset-y-2 z-10 w-0.5 bg-white" style={{ left: preview.drop.left }} />}
    </div>
  </div>;
}
