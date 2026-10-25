import clsx from 'clsx';
import { useEffect, useMemo, useRef } from 'react';

import { PlacementLocationBadge } from '../../../../components/kiosk/PlacementLocationBadge';
import { KioskResourceProcessChips } from '../../../../components/kiosk/resourceProgress/KioskResourceProcessChips';
import { IconActionTooltip } from '../../../../components/ui/IconActionTooltip';
import { progressOverviewProcessChipClassName } from '../../productionSchedule/progressOverviewPresentation';
import { pageZoom } from '../pageZoom';
import { usePlanningBoardProcessChips } from '../planningBoardProcessChips';

import { CHIP_LINE_HEIGHT, CHIP_STRIP_FIT, chipCodes, doneChipLabel, layoutChipStrips, moreChipLabel, planningBoardBadgeWidth } from './planningBoardChipStrips';
import { canReorderForwardBars, forwardItemDetails } from './planningBoardForwardQueue';
import { dateToDay, workingPeriods } from './planningBoardGanttLayout';
import { GANTT_FORWARD_LABEL_WIDTH } from './PlanningBoardGanttRow';
import { PlanningBoardPinIcon } from './PlanningBoardPinIcon';

import type { GanttBar, GanttRow } from './planningBoardGanttLayout';
import type { GrindingPlanningBoardItem, GrindingPlanningBoardResourceOrderPlacement } from '@raspi-system/shared-types';
import type { PointerEvent, ReactNode } from 'react';

export type ForwardReorder = (item: GrindingPlanningBoardItem, target: GrindingPlanningBoardItem, placement: GrindingPlanningBoardResourceOrderPlacement) => void;
export type ForwardMove = (item: GrindingPlanningBoardItem, resource: string, target: GrindingPlanningBoardItem | null, placement: GrindingPlanningBoardResourceOrderPlacement) => void;
type Drop = { resource: string; bar: GanttBar | null; placement: GrindingPlanningBoardResourceOrderPlacement; left: number };
export type ForwardDragPreview = { bar: GanttBar; x: number; y: number; allowed: ReadonlySet<string>; drop: Drop | null };
type Drag = { bar: GanttBar; x: number; y: number; tapCancelled: boolean; longPressed: boolean; selected: boolean; pointerId: number; element: HTMLButtonElement; moved: boolean; allowed?: ReadonlySet<string> };
type Props = {
  row: GanttRow;
  seibanColors?: ReadonlyMap<string, string>;
  focusedSeiban?: string | null;
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
  pausesForBreaks?: boolean;
  selectedItemIds: ReadonlySet<string>;
  disabled: boolean;
  dragDisabled: boolean;
  resourceView: boolean;
  onToggleItem: (item: GrindingPlanningBoardItem, selected: boolean) => void;
  onResourceReorder?: ForwardReorder;
  onResourceMove?: ForwardMove;
  canMoveResource?: (item: GrindingPlanningBoardItem, resource: string) => boolean;
  lanes: readonly { resource: string; bars: GanttBar[] }[];
  resource?: string;
  preview: ForwardDragPreview | null;
  onDragPreview: (preview: ForwardDragPreview | null) => void;
  pinMode?: boolean;
  onTogglePin?: (item: GrindingPlanningBoardItem) => void;
  focusedPartKey: string | null;
  chainPositions: ReadonlyMap<string, number>;
  onFocusChain: (bar: GanttBar) => void;
};

export function PlanningBoardForwardGanttRow({ row, seibanColors, focusedSeiban = null, label, start, end, now, width, dayWidth, hours, pausesForBreaks = true, scale, onShowQueue, onLeaveQueue, onCloseQueue,
  selectedItemIds, disabled, dragDisabled, pinMode = false, onTogglePin, resourceView, onToggleItem, onResourceReorder, onResourceMove, canMoveResource,
  lanes, resource, preview, onDragPreview, focusedPartKey, chainPositions, onFocusChain }: Props) {
  const track = useRef<HTMLDivElement>(null);
  const drag = useRef<Drag | null>(null);
  const suppressClick = useRef(false);
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cancelLongPress = () => {
    if (longPressTimer.current !== null) clearTimeout(longPressTimer.current);
    longPressTimer.current = null;
  };
  const breaks = useMemo(() => {
    const periods = workingPeriods(hours, pausesForBreaks);
    return periods.slice(1).map((period, index) => ({ start: periods[index]!.end, end: period.start }));
  }, [hours, pausesForBreaks]);
  const offHours = useMemo(() => {
    const periods = workingPeriods(hours);
    return [{ start: 0, end: periods[0]!.start }, { start: periods[periods.length - 1]!.end, end: 1 }];
  }, [hours]);
  const clear = () => {
    cancelLongPress();
    const pending = drag.current;
    drag.current = null;
    onDragPreview(null);
    if (pending?.element.hasPointerCapture?.(pending.pointerId)) pending.element.releasePointerCapture(pending.pointerId);
  };
  useEffect(() => {
    const cancel = () => { cancelLongPress(); if (drag.current) { suppressClick.current = true; drag.current = null; onDragPreview(null); } };
    window.addEventListener('blur', cancel);
    return () => { cancel(); window.removeEventListener('blur', cancel); };
  }, [onDragPreview]);
  useEffect(() => { cancelLongPress(); if (drag.current) { suppressClick.current = true; drag.current = null; onDragPreview(null); } }, [row, dayWidth, disabled, dragDisabled, pinMode, onDragPreview]);
  const findDrop = (clientX: number, clientY: number, pending: Drag): Drop | null => {
    const source = pending.bar;
    const board = track.current?.closest('[data-testid="planning-board-gantt"]');
    const lane = (document.elementsFromPoint?.(clientX, clientY) ?? [])
      .map((element) => element.closest<HTMLElement>('[data-gantt-lane]')).find((element) => element && board?.contains(element));
    const targetResource = lane?.dataset.resourceCode;
    if (!targetResource || !pending.allowed?.has(targetResource)) return null;
    const targetLane = lanes.find((candidate) => candidate.resource === targetResource);
    const targetTrack = lane.querySelector<HTMLElement>('[data-gantt-track]');
    if (!targetLane || !targetTrack) return null;
    const x = (clientX - targetTrack.getBoundingClientRect().left) / pageZoom();
    const centre = (bar: GanttBar) => (bar.start! - start) * dayWidth +
      (bar.unknown ? 70 : Math.max(2, ((bar.segments?.[0]?.end ?? bar.end!) - bar.start!) * dayWidth - 2)) / 2;
    const others = targetLane.bars.filter((bar) => bar.item.itemId !== source.item.itemId).sort((a, b) => centre(a) - centre(b));
    if (!others.length) return targetResource === source.resource ? null : { resource: targetResource, bar: null, placement: 'after', left: 0 };
    const target = others.find((bar) => x < centre(bar));
    const bar = target ?? others[others.length - 1]!;
    if (targetResource === source.resource && !canReorderForwardBars(source, bar)) return null;
    return { resource: targetResource, bar, placement: target ? 'before' : 'after', left: ((target ? bar.start! : bar.end!) - start) * dayWidth };
  };
  const move = (event: PointerEvent<HTMLButtonElement>) => {
    const pending = drag.current;
    if (!pending || pending.pointerId !== event.pointerId) return;
    const dx = event.clientX - pending.x;
    const distance = Math.hypot(dx, event.clientY - pending.y);
    if (distance >= 8) {
      pending.tapCancelled = true;
      cancelLongPress();
    }
    if (pending.longPressed) {
      if (distance < 8) return;
      pending.longPressed = false;
      onToggleItem(pending.bar.item, pending.selected);
    }
    if (!pending.moved && distance >= 8) { pending.moved = true; onCloseQueue(); }
    if (pending.moved && !disabled && !dragDisabled && !pinMode && resourceView) {
      pending.allowed ??= new Set(lanes.filter((lane) => lane.resource === pending.bar.resource || canMoveResource?.(pending.bar.item, lane.resource)).map((lane) => lane.resource));
      onDragPreview({ bar: pending.bar, x: event.clientX, y: event.clientY, allowed: pending.allowed, drop: findDrop(event.clientX, event.clientY, pending) });
    }
  };
  const chipsByPart = usePlanningBoardProcessChips();
  // One chip strip per part under its first bar: completed chips fold into 「済N」, at most two lines, and what still does not fit becomes 「+N」.
  const chipLayout = useMemo(() => {
    const barStart = (bar: GanttBar) => bar.unknown ? bar.start : bar.segments?.[0]?.start;
    const firstBars = new Map<string, GanttBar & { start: number }>();
    for (const bar of row.bars) {
      const left = barStart(bar);
      const current = firstBars.get(bar.partKey);
      if (left != null && (chipsByPart.get(bar.partKey)?.length || planningBoardBadgeWidth(bar.item)) && (!current || left < current.start)) firstBars.set(bar.partKey, { ...bar, start: left });
    }
    return layoutChipStrips([...firstBars.values()].map((bar) => {
      const chips = chipsByPart.get(bar.partKey) ?? [];
      return { bar, chips, badgeWidth: planningBoardBadgeWidth(bar.item), left: (bar.start - start) * dayWidth };
    }), CHIP_STRIP_FIT);
  }, [row.bars, chipsByPart, start, dayWidth]);
  return <div className="flex border-b border-slate-600" style={{ minHeight: 76 + chipLayout.lines * CHIP_LINE_HEIGHT }} data-testid={`planning-forward-lane-${row.key}`}>
    <div data-gantt-lane-label className="sticky left-0 z-20 flex shrink-0 flex-col justify-center gap-1 border-r border-slate-700 bg-slate-900 px-2 py-1 text-xs" style={{ width: GANTT_FORWARD_LABEL_WIDTH }}>
      {label ?? <><strong className="truncate">{row.label}</strong><span className="truncate text-slate-400">{row.detail}</span></>}
    </div>
    <div ref={track} data-gantt-track className="relative shrink-0 overflow-hidden" style={{ width }}>
      {hours < 24 && Array.from({ length: end - start }, (_, i) => <div key={i} className="pointer-events-none">
        {offHours.map((gap, index) => <span key={index} className="absolute inset-y-0 bg-slate-950/55"
          style={{ left: (i + gap.start) * dayWidth, width: (gap.end - gap.start) * dayWidth }} />)}
        {breaks.map((gap, index) => <span key={`break-${index}`} data-testid="planning-gantt-break" className="pointer-events-none absolute inset-y-0 opacity-80"
          style={{ left: (i + gap.start) * dayWidth, width: (gap.end - gap.start) * dayWidth,
            background: 'repeating-linear-gradient(135deg, rgb(51 65 85) 0 4px, transparent 4px 8px)' }} />)}
      </div>)}
      <span data-testid="planning-gantt-now" className="pointer-events-none absolute inset-y-0 z-[3] border-l-2 border-yellow-400" style={{ left: (now - start) * dayWidth }} />
      {row.connectors.map((link, i) => <span key={i} className="pointer-events-none absolute top-9 border-t-2 border-dotted border-amber-400" style={{ left: (link.start - start) * dayWidth, width: (link.end - link.start) * dayWidth }} />)}
      {chipLayout.strips.map(({ bar, left, line, done, shown, hidden, badgeWidth }) => <div key={`chips:${bar.item.itemId}`} data-testid={`planning-gantt-chips-${bar.item.itemId}`}
        className="pointer-events-none absolute flex flex-nowrap gap-0.5" style={{ left, top: 76 + line * CHIP_LINE_HEIGHT }}>
        {bar.item.placement && <span className="inline-flex shrink-0" style={{ width: badgeWidth }}>
          <PlacementLocationBadge placement={bar.item.placement} />
        </span>}
        {done.length > 0 && <IconActionTooltip label={`完了: ${chipCodes(done)}`}>
          <span className={`pointer-events-auto ${progressOverviewProcessChipClassName(true)}`}>{doneChipLabel(done.length)}</span>
        </IconActionTooltip>}
        {shown.length > 0 && <KioskResourceProcessChips processes={shown} className="flex-nowrap" />}
        {hidden.length > 0 && <IconActionTooltip label={`ほか: ${chipCodes(hidden)}`}>
          <span className="pointer-events-auto rounded border border-slate-500 px-1 py-0.5 text-[10px] leading-none text-slate-200">{moreChipLabel(hidden.length)}</span>
        </IconActionTooltip>}
      </div>)}
      {row.bars.map((bar) => {
        const color = bar.tone !== 'completed' ? seibanColors?.get(bar.item.fseiban) : undefined;
        const selected = selectedItemIds.has(bar.item.itemId);
        const inChain = focusedPartKey === bar.partKey;
        const segments = bar.unknown ? [{ start: bar.start!, end: bar.end! }] : bar.segments ?? [];
        return <div key={bar.item.itemId}>
          {segments.map((segment, index) => {
            const segmentWidth = bar.unknown ? 70 : Math.max(2, (segment.end - segment.start) * dayWidth - 2);
            return <button key={index} type="button" data-testid={`planning-gantt-bar-${bar.item.itemId}${index ? `-segment-${index}` : ''}`}
              data-gantt-pinned={bar.item.orderPinned ? 'true' : undefined}
              data-gantt-late={bar.tone === 'late' && index === 0 ? 'true' : undefined}
              aria-label={`${bar.item.fhinmei || bar.item.fhincd} 工順${bar.item.processOrder} ${bar.resource} 納期${bar.due ?? 'なし'}`}
              aria-pressed={pinMode ? Boolean(bar.item.orderPinned) : selected} disabled={disabled || bar.item.isCompleted}
              data-drag-disabled={pinMode || dragDisabled || disabled || !resourceView}
              className={clsx('absolute top-[3px] h-[70px] touch-pan-y select-none rounded text-left text-[11px] font-bold leading-[14px] focus-visible:outline focus-visible:outline-2 focus-visible:outline-white',
                inChain && index === 0 ? 'overflow-visible' : 'overflow-hidden',
                seibanColors && bar.tone === 'completed' ? 'bg-slate-600 text-slate-300' : color ? `${color} text-slate-950` : bar.tone === 'late' ? 'bg-rose-400 text-slate-950' : 'bg-sky-400 text-slate-950',
                bar.unknown && (seibanColors ? 'border border-dashed border-slate-200' : 'border border-dashed border-slate-200 bg-slate-800 text-slate-200'),
                inChain ? 'outline outline-2 outline-offset-1 outline-white' : selected && 'outline outline-2 outline-offset-1 outline-emerald-300',
                focusedSeiban !== null ? focusedSeiban === bar.item.fseiban ? 'ring-2 ring-white' : 'opacity-20 saturate-[.3]' : focusedPartKey !== null && !inChain && 'opacity-30',
                index > 0 && 'border-l-2 border-dashed border-slate-950')}
              style={{ boxShadow: bar.item.orderPinned ? `${focusedSeiban === bar.item.fseiban ? 'var(--tw-ring-offset-shadow, 0 0 #0000), var(--tw-ring-shadow, 0 0 #0000), ' : ''}inset 0 0 0 3px rgb(251 191 36)` : undefined, left: (segment.start - start) * dayWidth, width: segmentWidth,
                opacity: preview?.bar.item.itemId === bar.item.itemId ? 0.3 : undefined,
                outline: preview?.bar.item.itemId === bar.item.itemId ? '3px solid rgb(251 191 36)' : undefined,
                outlineOffset: preview?.bar.item.itemId === bar.item.itemId ? -3 : undefined,
                zIndex: preview?.bar.item.itemId === bar.item.itemId ? 9 : inChain ? 8 : selected ? 4 : 2 }}
              onPointerEnter={(event) => { if (event.pointerType === 'mouse' && !drag.current) onShowQueue(bar, event.currentTarget); }}
              onPointerLeave={(event) => { if (event.pointerType === 'mouse') onLeaveQueue(); }}
              onPointerDown={(event) => {
                onCloseQueue();
                if (disabled || bar.item.isCompleted || event.button !== 0 || event.isPrimary === false || drag.current) return;
                suppressClick.current = false;
                drag.current = { bar, x: event.clientX, y: event.clientY, tapCancelled: false, longPressed: false, selected, pointerId: event.pointerId, element: event.currentTarget, moved: false };
                if (!pinMode) longPressTimer.current = setTimeout(() => {
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
                const drop = findDrop(event.clientX, event.clientY, pending);
                suppressClick.current = pending.tapCancelled || pending.longPressed;
                clear();
                if (pending.moved && drop && !disabled && !dragDisabled && !pinMode && resourceView) {
                  if (drop.resource !== pending.bar.resource) onResourceMove?.(pending.bar.item, drop.resource, drop.bar?.item ?? null, drop.placement);
                  else if (drop.bar) onResourceReorder?.(pending.bar.item, drop.bar.item, drop.placement);
                }
              }}
              onPointerCancel={() => { suppressClick.current = true; clear(); }}
              onLostPointerCapture={() => { if (drag.current) { suppressClick.current = true; clear(); } }}
              onClick={() => {
                if (suppressClick.current) { suppressClick.current = false; return; }
                if (pinMode) onTogglePin?.(bar.item); else onFocusChain(bar);
              }}>
              {bar.item.orderPinned && index === 0 && <PlanningBoardPinIcon className="pointer-events-none absolute bottom-1 right-1 h-4 w-4 text-amber-300" />}
              {inChain && index === 0 && <span data-testid={`planning-gantt-chain-badge-${bar.item.itemId}`} className="pointer-events-none absolute right-0 top-0 grid h-[22px] w-[22px] place-items-center rounded-full bg-slate-950 font-mono text-xs font-bold text-white">{chainPositions.get(bar.item.itemId)}</span>}
              {bar.unknown ? '所要不明' : segmentWidth >= 48
                ? <span className="block break-all px-1"><b className="line-clamp-2">{bar.item.fhinmei || bar.item.fhincd}</b>
                  <small className="line-clamp-3 text-[11px] font-normal">{index > 0 ? '続き' : scale <= 2 ? forwardItemDetails(bar.item) : `${bar.item.requiredMinutes}分`}</small>
                </span> : null}
            </button>;
          })}
          {selected && bar.due && <span data-testid={`planning-gantt-due-${bar.item.itemId}`} title={`納期 ${bar.due}`} className="pointer-events-none absolute bottom-0 -translate-x-1/2 text-xs leading-none text-rose-400"
            style={{ left: Math.max(0, (dateToDay(bar.due) + 1 - start) * dayWidth) }}>▲</span>}
        </div>;
      })}
      {preview?.drop && preview.drop.resource === resource && <span data-testid="planning-gantt-insertion" className="pointer-events-none absolute inset-y-2 z-10 w-0.5 bg-emerald-300" style={{ left: preview.drop.left }} />}
    </div>
  </div>;
}
