import clsx from 'clsx';
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { PlacementLocationBadge } from '../../../../components/kiosk/PlacementLocationBadge';
import { KioskResourceProcessChips } from '../../../../components/kiosk/resourceProgress/KioskResourceProcessChips';
import { IconActionTooltip } from '../../../../components/ui/IconActionTooltip';
import { progressOverviewProcessChipClassName } from '../../productionSchedule/progressOverviewPresentation';
import { formatPlanningBoardItemMinutes } from '../planningBoardLoad';

import { CHIP_LINE_HEIGHT, CHIP_STRIP_FIT, chipCodes, doneChipLabel, layoutChipStrips, moreChipLabel, planningBoardBadgeWidth } from './planningBoardChipStrips';
import { findForwardDrop } from './planningBoardForwardDrop';
import { forwardItemDetails } from './planningBoardForwardQueue';
import { dayLabel, dateToDay, workingPeriods } from './planningBoardGanttLayout';
import { GANTT_FORWARD_LABEL_WIDTH } from './PlanningBoardGanttRow';
import { PlanningBoardGanttSendOutStars } from './PlanningBoardGanttSendOutStars';
import { PlanningBoardLateStar, PlanningBoardLateStarDates, usePlanningBoardLateStars } from './planningBoardLateStars';
import { PIECE_NOTCH_MIN_WIDTH, pieceNotchClipPath } from './planningBoardPieceNotch';
import { PlanningBoardPinIcon } from './PlanningBoardPinIcon';

import type { PlanningBoardPlacementByPart, PlanningBoardProcessChipsByPart } from '../planningBoardProcessChips';
import type { GanttBar, GanttRow } from './planningBoardGanttLayout';
import type { ForwardDragLane, SingleResourceWindow } from './planningBoardSingleResourceWindows';
import type { GanttWindow } from './usePlanningBoardGanttWindow';
import type { GrindingPlanningBoardItem, GrindingPlanningBoardResourceOrderPlacement } from '@raspi-system/shared-types';
import type { PointerEvent, ReactNode } from 'react';

export type ForwardReorder = (item: GrindingPlanningBoardItem, target: GrindingPlanningBoardItem, placement: GrindingPlanningBoardResourceOrderPlacement) => void;
export type ForwardMove = (item: GrindingPlanningBoardItem, resource: string, target: GrindingPlanningBoardItem | null, placement: GrindingPlanningBoardResourceOrderPlacement) => void;
type Drop = { rowKey?: string; resource: string; bar: GanttBar | null; placement: GrindingPlanningBoardResourceOrderPlacement; left: number };
export type ForwardDragPreview = { rowKey?: string; source?: 'queue'; bar: GanttBar; x: number; y: number; allowed: ReadonlySet<string>; drop: Drop | null };
type Drag = { bar: GanttBar; x: number; y: number; tapCancelled: boolean; longPressed: boolean; selected: boolean; pointerId: number; element: HTMLButtonElement; moved: boolean; allowed?: ReadonlySet<string> };
type Props = {
  foldedWindow?: SingleResourceWindow;
  dayLoad?: number;
  row: GanttRow;
  window?: GanttWindow;
  registerRow?: (key: string, element: HTMLDivElement | null) => void;
  chipsByPart: PlanningBoardProcessChipsByPart;
  placementByPart: PlanningBoardPlacementByPart;
  seibanColors?: ReadonlyMap<string, string>;
  focusedSeiban?: string | null;
  onToggleSeiban?: (fseiban: string) => void;
  label?: ReactNode;
  start: number;
  end: number;
  today?: number;
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
  lanes: { readonly current: readonly ForwardDragLane[] };
  draggedItemId: string | null;
  insertionLeft: number | null;
  onDragPreview: (preview: ForwardDragPreview | null) => void;
  pinMode?: boolean;
  onTogglePin?: (item: GrindingPlanningBoardItem) => void;
  focusedPartKey: string | null;
  chainPositions: ReadonlyMap<string, number>;
  onFocusChain: (bar: GanttBar, keepOpen?: boolean) => void;
};

export const PlanningBoardForwardGanttRow = memo(function PlanningBoardForwardGanttRow({ foldedWindow, dayLoad = 0, row, window = null, registerRow, chipsByPart, placementByPart, seibanColors, focusedSeiban = null, onToggleSeiban, label, start, today, now, width, dayWidth, hours, pausesForBreaks = true, scale, onShowQueue, onLeaveQueue, onCloseQueue,
  selectedItemIds, disabled, dragDisabled, pinMode = false, onTogglePin, resourceView, onToggleItem, onResourceReorder, onResourceMove, canMoveResource,
  lanes, draggedItemId, insertionLeft, onDragPreview, focusedPartKey, chainPositions, onFocusChain }: Props) {
  const rowRef = useCallback((element: HTMLDivElement | null) => registerRow?.(row.key, element), [registerRow, row.key]);
  const [heldItemId, setHeldItemId] = useState<string | null>(null);
  const currentDay = today ?? Math.floor(now);
  const lateStars = usePlanningBoardLateStars(row.bars, currentDay);
  const track = useRef<HTMLDivElement>(null);
  const drag = useRef<Drag | null>(null);
  const dragPointer = useRef({ x: 0, y: 0 });
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
  // Repeat each gap from its original left edge. Each hatch tile restarts at the same phase as the old daily span.
  const calendarBands = useMemo(() => hours < 24 && <>
    {offHours.map((gap, index) => <span key={index} data-gantt-decoration="offHourBands" className="pointer-events-none absolute inset-y-0"
      style={{ left: gap.start * dayWidth, width: width - gap.start * dayWidth,
        backgroundImage: `repeating-linear-gradient(to right, rgb(2 6 23 / 0.55) 0 ${(gap.end - gap.start) * dayWidth}px, transparent ${(gap.end - gap.start) * dayWidth}px ${dayWidth}px)` }} />)}
    {breaks.map((gap, index) => <span key={`break-${index}`} data-testid="planning-gantt-break" className="pointer-events-none absolute inset-y-0 opacity-80"
      style={{ left: gap.start * dayWidth, width: width - gap.start * dayWidth,
        background: 'repeating-linear-gradient(135deg, rgb(51 65 85) 0 4px, transparent 4px 8px)',
        backgroundSize: `${dayWidth}px 100%`,
        maskImage: `repeating-linear-gradient(to right, black 0 ${(gap.end - gap.start) * dayWidth}px, transparent ${(gap.end - gap.start) * dayWidth}px ${dayWidth}px)` }} />)}
  </>, [hours, width, offHours, breaks, dayWidth]);
  const clear = () => {
    cancelLongPress();
    const pending = drag.current;
    drag.current = null;
    setHeldItemId(null);
    onDragPreview(null);
    if (pending?.element.hasPointerCapture?.(pending.pointerId)) pending.element.releasePointerCapture(pending.pointerId);
  };
  useEffect(() => {
    const cancel = () => { cancelLongPress(); if (drag.current) { suppressClick.current = true; drag.current = null; setHeldItemId(null); onDragPreview(null); } };
    globalThis.window.addEventListener('blur', cancel);
    return () => { cancel(); globalThis.window.removeEventListener('blur', cancel); };
  }, [onDragPreview]);
  useEffect(() => { cancelLongPress(); if (drag.current) { suppressClick.current = true; drag.current = null; setHeldItemId(null); onDragPreview(null); } }, [row, dayWidth, disabled, dragDisabled, pinMode, onDragPreview]);
  const findDrop = (clientX: number, clientY: number, pending: Drag): Drop | null => {
    return findForwardDrop(clientX, clientY, pending.bar, pending.allowed,
      track.current?.closest('[data-testid="planning-board-gantt"]'), lanes.current, start, dayWidth);
  };
  useEffect(() => {
    if (!foldedWindow || !heldItemId) return;
    let frame: number;
    const scroll = () => {
      const pending = drag.current;
      if (!pending) return;
      const viewport = track.current?.closest<HTMLElement>('[data-gantt-viewport]');
      if (pending.moved && pending.allowed && viewport) {
        const bounds = viewport.getBoundingClientRect();
        const { x, y } = dragPointer.current;
        const delta = y > bounds.bottom - 40 ? 12 : y < bounds.top + 40 ? -12 : 0;
        if (delta && bounds.height > 0) {
          const previous = viewport.scrollTop;
          viewport.scrollTop += delta;
          if (viewport.scrollTop !== previous) onDragPreview({ rowKey: row.key, bar: pending.bar, x, y, allowed: pending.allowed,
            drop: findForwardDrop(x, y, pending.bar, pending.allowed, viewport.closest('[data-testid="planning-board-gantt"]'), lanes.current, start, dayWidth) });
        }
      }
      frame = requestAnimationFrame(scroll);
    };
    frame = requestAnimationFrame(scroll);
    return () => cancelAnimationFrame(frame);
  }, [foldedWindow, heldItemId, row.key, lanes, start, dayWidth, onDragPreview]);
  const move = (event: PointerEvent<HTMLButtonElement>) => {
    const pending = drag.current;
    if (!pending || pending.pointerId !== event.pointerId) return;
    dragPointer.current = { x: event.clientX, y: event.clientY };
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
      pending.allowed ??= new Set(lanes.current.filter((lane) => lane.resource === pending.bar.resource || canMoveResource?.(pending.bar.item, lane.resource)).map((lane) => lane.resource));
      onDragPreview({ rowKey: row.key, bar: pending.bar, x: event.clientX, y: event.clientY, allowed: pending.allowed, drop: findDrop(event.clientX, event.clientY, pending) });
    }
  };
  // One chip strip per part under its first bar: completed chips fold into 「済N」, at most two lines, and what still does not fit becomes 「+N」.
  const chipLayout = useMemo(() => {
    const barStart = (bar: GanttBar) => bar.unknown ? bar.start : bar.segments?.[0]?.start;
    const placementOf = (bar: GanttBar) => placementByPart.get(bar.partKey) ?? bar.item.placement ?? null;
    const firstBars = new Map<string, GanttBar & { start: number }>();
    for (const bar of row.bars) {
      const left = barStart(bar);
      const current = firstBars.get(bar.partKey);
      if (left != null && (chipsByPart.get(bar.partKey)?.length || planningBoardBadgeWidth(placementOf(bar))) && (!current || left < current.start)) firstBars.set(bar.partKey, { ...bar, start: left });
    }
    return layoutChipStrips([...firstBars.values()].map((bar) => {
      const chips = chipsByPart.get(bar.partKey) ?? [];
      const placement = placementOf(bar);
      return { bar, chips, placement, badgeWidth: planningBoardBadgeWidth(placement), left: (bar.start - start) * dayWidth };
    }), CHIP_STRIP_FIT);
  }, [row.bars, chipsByPart, placementByPart, start, dayWidth]);
  const visibleBars = useMemo(() => row.bars.filter((bar) => {
    // A selected bar's due mark sits on its due day, which can be on screen while the bar itself is not.
    if (!window || bar.item.itemId === heldItemId || bar.item.itemId === draggedItemId || selectedItemIds.has(bar.item.itemId)) return true;
    const segments = bar.unknown ? [{ start: bar.start!, end: bar.start! + 70 / dayWidth }] : bar.segments ?? [];
    return segments.some((segment) => (segment.start - start) * dayWidth <= window.right
      && (segment.end - start) * dayWidth >= window.left);
  }), [row.bars, window, heldItemId, draggedItemId, selectedItemIds, start, dayWidth]);
  const visibleIds = new Set(visibleBars.map((bar) => bar.item.itemId));
  const day = foldedWindow?.day ?? Math.floor(start);
  const weekday = new Date(day * 86_400_000).getUTCDay();
  const timeLabel = (value: number) => {
    const minute = Math.round((value - Math.floor(value + 1e-9)) * 1440);
    return minute === 0 && value > start ? '24' : minute % 60 ? `${Math.floor(minute / 60)}:${String(minute % 60).padStart(2, '0')}` : `${minute / 60}`;
  };
  const workingHour = (offset: number) => {
    let remaining = offset / 24;
    for (const period of foldedWindow?.periods ?? []) {
      if (remaining < period.end - period.start - 1e-9) return timeLabel(period.start + remaining);
      remaining -= period.end - period.start;
    }
    return timeLabel((foldedWindow?.end ?? start) + remaining);
  };
  const shiftPeriods = workingPeriods(hours, pausesForBreaks);
  const firstOfDay = !foldedWindow?.working || Math.abs(start - day - shiftPeriods[0]!.start) < 1e-9;
  const lastOfDay = !foldedWindow?.working || Math.abs(foldedWindow.end - day - shiftPeriods[shiftPeriods.length - 1]!.end) < 1e-9;
  const workingWidth = foldedWindow?.periods.reduce((sum, period) => sum + period.end - period.start, 0) ?? 0;
  const rowBaseHeight = foldedWindow ? 96 : 76;
  return <div ref={rowRef} data-gantt-window-row={foldedWindow ? row.key : undefined}
    data-gantt-lane={foldedWindow ? '' : undefined} data-resource-code={foldedWindow ? row.label : undefined} className="flex border-b border-slate-600" style={{ minHeight: rowBaseHeight + chipLayout.lines * CHIP_LINE_HEIGHT }} data-testid={`planning-forward-lane-${row.key}`}>
    <div data-gantt-lane-label className={clsx('sticky left-0 z-20 flex shrink-0 flex-col border-r border-slate-700 px-2 py-0.5 text-xs', foldedWindow && [0, 6].includes(weekday) ? 'bg-slate-800' : 'bg-slate-900', foldedWindow ? 'justify-start gap-1.5 pt-2' : 'justify-evenly')} style={{ width: GANTT_FORWARD_LABEL_WIDTH }}>
      {foldedWindow ? <>
        {firstOfDay && <div className="flex items-baseline gap-1.5 whitespace-nowrap">
          <b className={clsx('font-mono text-xl', day === currentDay && 'rounded bg-emerald-400 px-1 text-slate-950')}>{dayLabel(day)}</b>
          <span className="text-sm font-bold text-slate-400">{['日', '月', '火', '水', '木', '金', '土'][weekday]}</span>
        </div>}
        <span className="whitespace-nowrap font-mono text-sm font-bold text-slate-400">{foldedWindow.working ? `${timeLabel(foldedWindow.start)}–${timeLabel(foldedWindow.end)}時` : `–${dayLabel(foldedWindow.end - 1)}`}</span>
        {lastOfDay && <span role="meter" aria-label={`${dayLabel(day)}の負荷`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(Math.min(1, dayLoad) * 100)}
          className="relative mb-2 mt-auto h-1.5 overflow-hidden rounded-sm bg-slate-800"><i className="absolute inset-y-0 left-0 bg-sky-400" style={{ width: `${Math.min(1, dayLoad) * 100}%` }} /></span>}
      </> : label ?? <><strong className="truncate">{row.label}</strong><span className="truncate text-slate-400">{row.detail}</span></>}
      <PlanningBoardLateStarDates groups={lateStars.groups} focusedSeiban={focusedSeiban} onToggleSeiban={onToggleSeiban} />
    </div>
    <div ref={track} data-gantt-track className="relative shrink-0 overflow-hidden" style={{ width }}>
      <PlanningBoardGanttSendOutStars bars={row.bars} window={window} start={start} dayWidth={dayWidth} />
      {(!foldedWindow || !foldedWindow.working) && calendarBands}
      {foldedWindow?.working && workingWidth < 6 / 24 - 1e-9 && <span data-gantt-decoration="offHourBands"
        className="pointer-events-none absolute inset-y-0 bg-slate-950/55" style={{ left: workingWidth * dayWidth, width: Math.max(0, width - workingWidth * dayWidth) }} />}
      {foldedWindow?.working && foldedWindow.periods.slice(1).map((period, index) => <span key={`break:${index}`} data-testid="planning-gantt-break"
        className="pointer-events-none absolute inset-y-0 border-l-2 border-dashed border-slate-500" style={{ left: foldedWindow.periods.slice(0, index + 1).reduce((sum, part) => sum + part.end - part.start, 0) * dayWidth }} />)}
      {foldedWindow && (foldedWindow.working ? Array.from({ length: 7 }, (_, hour) => <span key={hour}
        className="pointer-events-none absolute inset-y-0 border-l border-slate-700/60" style={{ left: hour / 24 * dayWidth }}>
        {hour < 6 && <span className="absolute left-1 top-0.5 whitespace-nowrap text-xs font-bold text-slate-400">{workingHour(hour)}時</span>}
      </span>) : Array.from({ length: Math.round(foldedWindow.end - foldedWindow.start) + 1 }, (_, index) => {
        const tickDay = foldedWindow.start + index;
        const weekend = [0, 6].includes(new Date(tickDay * 86_400_000).getUTCDay());
        return <span key={index} data-testid="planning-single-day-tick" className={clsx('pointer-events-none absolute inset-y-0 border-l border-slate-600', weekend && 'bg-slate-800/60')}
          style={{ left: index * dayWidth, width: index < foldedWindow.end - foldedWindow.start ? dayWidth : 0 }}>
          {index < foldedWindow.end - foldedWindow.start && (scale <= 7 || index % 7 === 0) && <span className="absolute left-1 top-0.5 whitespace-nowrap text-xs font-bold text-slate-400">{dayLabel(tickDay)}({['日', '月', '火', '水', '木', '金', '土'][new Date(tickDay * 86_400_000).getUTCDay()]})</span>}
        </span>;
      }))}
      {Number.isFinite(now) && <span data-testid="planning-gantt-now" className="pointer-events-none absolute inset-y-0 z-[3] border-l-2 border-yellow-400" style={{ left: (now - start) * dayWidth }} />}
      {row.connectors.map((link, i) => <span key={i} className="pointer-events-none absolute top-9 border-t-2 border-dotted border-amber-400" style={{ left: (link.start - start) * dayWidth, width: (link.end - link.start) * dayWidth }} />)}
      {chipLayout.strips.filter(({ bar }) => visibleIds.has(bar.item.itemId)).map(({ bar, left, line, done, shown, hidden, placement, badgeWidth }) => <div key={`chips:${bar.item.itemId}`} data-testid={`planning-gantt-chips-${bar.item.itemId}`}
        className="pointer-events-none absolute flex flex-nowrap gap-0.5" style={{ left, top: rowBaseHeight + line * CHIP_LINE_HEIGHT }}>
        {placement && <span className="inline-flex shrink-0" style={{ width: badgeWidth }}>
          <PlacementLocationBadge placement={placement} />
        </span>}
        {done.length > 0 && <IconActionTooltip label={`完了: ${chipCodes(done)}`}>
          <span className={`pointer-events-auto ${progressOverviewProcessChipClassName(true)}`}>{doneChipLabel(done.length)}</span>
        </IconActionTooltip>}
        {shown.length > 0 && <KioskResourceProcessChips processes={shown} className="flex-nowrap" />}
        {hidden.length > 0 && <IconActionTooltip label={`ほか: ${chipCodes(hidden)}`}>
          <span className="pointer-events-auto rounded border border-slate-500 px-1 py-0.5 text-[10px] leading-none text-slate-200">{moreChipLabel(hidden.length)}</span>
        </IconActionTooltip>}
      </div>)}
      {visibleBars.map((bar) => {
        const color = bar.tone !== 'completed' ? seibanColors?.get(bar.item.fseiban) : undefined;
        const selected = selectedItemIds.has(bar.item.itemId);
        const inChain = focusedPartKey === bar.partKey;
        const segments = bar.unknown && !foldedWindow ? [{ start: bar.start!, end: bar.end! }] : bar.segments ?? [];
        return <div key={bar.item.itemId}>
          {segments.map((segment, index) => {
            const segmentWidth = bar.unknown && !foldedWindow ? 70 : Math.max(2, (segment.end - segment.start) * dayWidth - 2);
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
                focusedSeiban !== null ? focusedSeiban === bar.item.fseiban ? 'ring-2 ring-white' : 'opacity-20 saturate-[.3]' : focusedPartKey !== null && !inChain ? 'opacity-30' : undefined,
                draggedItemId === bar.item.itemId && '[&>*]:opacity-30',
                bar.item.quantityWarning && '!outline !outline-2 !-outline-offset-2 !outline-red-500',
                index > 0 && 'border-l-2 border-dashed border-slate-950')}
              style={{ top: foldedWindow ? 22 : undefined, boxShadow: bar.item.orderPinned ? `${focusedSeiban === bar.item.fseiban ? 'var(--tw-ring-offset-shadow, 0 0 #0000), var(--tw-ring-shadow, 0 0 #0000), ' : ''}inset 0 0 0 3px rgb(251 191 36)` : undefined, left: (segment.start - start) * dayWidth, width: segmentWidth,
                clipPath: bar.item.kind === 'piece' && segmentWidth >= PIECE_NOTCH_MIN_WIDTH ? pieceNotchClipPath({ left: index === 0, right: index === segments.length - 1 }) : undefined,
                backgroundColor: draggedItemId === bar.item.itemId ? 'rgb(15 23 42)' : undefined,
                color: draggedItemId === bar.item.itemId ? 'rgb(148 163 184)' : undefined,
                outline: draggedItemId === bar.item.itemId ? '3px dashed rgb(251 191 36)' : undefined,
                outlineOffset: draggedItemId === bar.item.itemId ? -3 : undefined,
                zIndex: draggedItemId === bar.item.itemId ? 9 : inChain ? 8 : selected ? 4 : 2 }}
              onPointerEnter={(event) => { if (event.pointerType === 'mouse' && !drag.current) onShowQueue(bar, event.currentTarget); }}
              onPointerLeave={(event) => { if (event.pointerType === 'mouse') onLeaveQueue(); }}
              onPointerDown={(event) => {
                onCloseQueue();
                if (disabled || bar.item.isCompleted || event.button !== 0 || event.isPrimary === false || drag.current) return;
                dragPointer.current = { x: event.clientX, y: event.clientY };
                setHeldItemId(bar.item.itemId);
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
                if (pinMode) onTogglePin?.(bar.item); else { if (foldedWindow) { onToggleItem(bar.item, !selected); onFocusChain(bar, true); } else onFocusChain(bar); }
              }}>
              {bar.item.orderPinned && index === 0 && <PlanningBoardPinIcon className="pointer-events-none absolute bottom-1 right-1 h-4 w-4 text-amber-300" />}
              {inChain && index === 0 && <span data-testid={`planning-gantt-chain-badge-${bar.item.itemId}`} className="pointer-events-none absolute right-0 top-0 grid h-[22px] w-[22px] place-items-center rounded-full bg-slate-950 font-mono text-xs font-bold text-white">{chainPositions.get(bar.item.itemId)}</span>}
              {bar.unknown ? '所要不明' : segmentWidth >= 48
                ? <span className="block break-all px-1"><b className="line-clamp-2">{bar.item.fhinmei || bar.item.fhincd}</b>
                  <small className="line-clamp-3 text-[11px] font-normal">{index > 0 ? '続き' : scale <= 2 ? forwardItemDetails(bar.item) : formatPlanningBoardItemMinutes(bar.item)}</small>
                </span> : null}
            </button>;
          })}
          {segments[0] && lateStars.itemIds.has(bar.item.itemId) && <PlanningBoardLateStar left={(segments[0].start - start) * dayWidth} top={foldedWindow ? 75 : 56} />}
          {selected && bar.due && <span data-testid={`planning-gantt-due-${bar.item.itemId}`} title={`納期 ${bar.due}`} className="pointer-events-none absolute bottom-0 -translate-x-1/2 text-xs leading-none text-rose-400"
            style={{ left: Math.max(0, (dateToDay(bar.due) + 1 - start) * dayWidth) }}>▲</span>}
        </div>;
      })}
      {insertionLeft !== null && <span data-testid="planning-gantt-insertion" className="pointer-events-none absolute inset-y-2 z-10 w-1 bg-emerald-300" style={{ left: insertionLeft }} />}
    </div>
  </div>;
});
