import { GRINDING_PLANNING_BOARD_RESOURCE_DAILY_HOURS, GRINDING_PLANNING_BOARD_DEFAULT_RESOURCE_DAILY_HOURS } from '@raspi-system/shared-types';
import clsx from 'clsx';
import { forwardRef, useCallback, useEffect, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

import { useMachineSignalResourceUptime } from '../../../../api/hooks/machine-signal';
import { normalizeMachineName } from '../../productionSchedule/machineName';
import { pageZoom } from '../pageZoom';
import { usePlanningBoardPlacementByPart, usePlanningBoardProcessChips } from '../planningBoardProcessChips';
import { compareProcessOrder } from '../sortGrindingPlanningBoardItems';
import { usePlanningBoardPaneOrder } from '../usePlanningBoardPaneOrder';

import { ganttResourceLabel } from './ganttResourceLabel';
import { PlanningBoardChainLinks } from './PlanningBoardChainLinks';
import { PlanningBoardChainStrip } from './PlanningBoardChainStrip';
import { PlanningBoardForwardGanttRow } from './PlanningBoardForwardGanttRow';
import { PlanningBoardForwardLaterQueue } from './PlanningBoardForwardLaterQueue';
import { PlanningBoardForwardQueuePopover } from './PlanningBoardForwardQueuePopover';
import { ganttBarGeometry } from './planningBoardGanttGeometry';
import { dayLabel, dayToDate, jstDay, planningBoardVisibleBars } from './planningBoardGanttLayout';
import { GANTT_FORWARD_LABEL_WIDTH, GANTT_LABEL_WIDTH, PlanningBoardGanttRow } from './PlanningBoardGanttRow';
import { sharePlanningBoardGanttLayout } from './planningBoardGanttSharing';
import { planningBoardSeibanColor } from './planningBoardSeibanColor';
import { usePlanningBoardGanttWindow } from './usePlanningBoardGanttWindow';

import type { ForwardDragPreview, ForwardMove, ForwardReorder } from './PlanningBoardForwardGanttRow';
import type { ForwardQueueHandle } from './PlanningBoardForwardQueuePopover';
import type { GanttBar, GanttLayout } from './planningBoardGanttLayout';
import type { PlanningBoardGanttRowProps } from './PlanningBoardGanttRow';
import type { GrindingPlanningBoardItem, GrindingPlanningBoardResourceDailyHours } from '@raspi-system/shared-types';

type Props = Pick<PlanningBoardGanttRowProps, 'onCompleteToggle' | 'completionPendingRowIds' | 'disabled' | 'dragDisabled' | 'onToggleItem' | 'onDueDrop' | 'selectedItemIds' | 'resourceView'> & {
  onResourceReorder?: ForwardReorder;
  onArrivalChange?: (item: GrindingPlanningBoardItem, recorded: boolean) => void;
  arrivalPending?: boolean;
  arrivalError?: boolean;
  onResourceMove?: ForwardMove;
  canMoveResource?: (item: GrindingPlanningBoardItem, resource: string) => boolean;
  pinMode?: boolean;
  onTogglePin?: (item: GrindingPlanningBoardItem) => void;
  runsThroughBreaks?: ReadonlySet<string>;
  onBreaksChange?: (resourceCd: string, runsThroughBreaks: boolean) => void;
  colorBySeiban?: boolean;
  focusedSeiban: string | null;
  onFocusedSeibanChange: (seiban: string | null) => void;
  seibanOrder?: readonly string[];
  layout: GanttLayout;
  scale: number;
  /** Changes each time a scale button is pressed, so the chart returns to today even on the current scale. */
  homeKey?: number;
  dailyHoursByResource: Readonly<Record<string, GrindingPlanningBoardResourceDailyHours>>;
  resourceNameMap: Record<string, string[]>;
  capacityPending: boolean;
  capacityError: boolean;
  onCapacityChange: (resourceCd: string, dailyHours: GrindingPlanningBoardResourceDailyHours) => void;
  /** Device-local lane order key, shared with the resource list panes. */
  preferenceScope?: string;
};
export type PlanningBoardGanttHandle = { scrollToNextOverlap: () => void; scrollToNextLate: () => void };
const EMPTY_SEIBAN_ORDER: readonly string[] = [];
const EMPTY_CHAIN: GanttBar[] = [];
const EMPTY_SELECTION: ReadonlySet<string> = new Set<string>();
const WEEKDAYS = ['日', '月', '火', '水', '木', '金', '土'];
const GANTT_BOTTOM_GAP = 10;
// With a 2- or 4-day span a day is wide enough to show where the hours fall.
const HOUR_TICKS = [8, 17, 20];
// The one-day scale fits six hours on screen so short jobs stay readable, with a tick every hour.
const ONE_DAY_VISIBLE_DAYS = 6 / 24;
const EVERY_HOUR = Array.from({ length: 24 }, (_, hour) => hour);
const SHIFT_START_HOUR = 8;
const HOUR_TICK_MIN_DAY_WIDTH = 160;
// The ‹ › buttons move the chart by two hours at any scale.
const NUDGE_DAYS = 2 / 24;

function laneAtPoint(x: number, y: number, resources: ReadonlySet<string>): HTMLElement | null {
  // Hit testing takes visual coordinates, just like pointer events.
  const elements = typeof document.elementsFromPoint === 'function' ? document.elementsFromPoint(x, y) : [];
  for (const element of elements) {
    const lane = element.closest<HTMLElement>('[data-gantt-lane]');
    if (lane?.dataset.resourceCode && resources.has(lane.dataset.resourceCode)) return lane;
  }
  return null;
}

export const PlanningBoardGanttView = forwardRef<PlanningBoardGanttHandle, Props>(function PlanningBoardGanttView({
  layout: currentLayout, scale, homeKey = 0, dailyHoursByResource, resourceNameMap, capacityPending, capacityError, onCapacityChange, runsThroughBreaks, onBreaksChange,
  focusedSeiban, onFocusedSeibanChange: setFocusedSeiban, onCompleteToggle, completionPendingRowIds,
  colorBySeiban = false, seibanOrder = EMPTY_SEIBAN_ORDER, preferenceScope = 'default', ...interaction
}, ref) {
  const uptime = useMachineSignalResourceUptime(currentLayout.mode === 'forward');
  const previousUptime = useRef<ReadonlyMap<string, number>>(new Map());
  const uptimeByResource = useMemo(() => {
    const next = new Map(uptime.data?.resources.map((entry) =>
      [normalizeMachineName(entry.resourceCd), entry.averageRunSeconds]));
    const previous = previousUptime.current;
    return next.size === previous.size && [...next].every(([key, value]) => previous.has(key) && Object.is(previous.get(key), value))
      ? previous : next;
  }, [uptime.data]);
  useLayoutEffect(() => { previousUptime.current = uptimeByResource; }, [uptimeByResource]);
  const incomingChips = usePlanningBoardProcessChips();
  const incomingPlacements = usePlanningBoardPlacementByPart();
  const previousDetails = useRef({ chips: incomingChips, placements: incomingPlacements });
  // Drag previews re-render this view on every pointer move; compare contents only when a context map changes.
  // eslint-disable-next-line react-hooks/exhaustive-deps -- previousDetails is a ref read only to keep the prior identity.
  const chipsByPart = useMemo(() => JSON.stringify([...incomingChips]) === JSON.stringify([...previousDetails.current.chips]) ? previousDetails.current.chips : incomingChips, [incomingChips]);
  // eslint-disable-next-line react-hooks/exhaustive-deps -- previousDetails is a ref read only to keep the prior identity.
  const placementByPart = useMemo(() => JSON.stringify([...incomingPlacements]) === JSON.stringify([...previousDetails.current.placements])
    ? previousDetails.current.placements : incomingPlacements, [incomingPlacements]);
  useLayoutEffect(() => { previousDetails.current = { chips: chipsByPart, placements: placementByPart }; }, [chipsByPart, placementByPart]);
  const previousLayout = useRef<GanttLayout | null>(null);
  const sourceLayout = useMemo(() => currentLayout.mode === 'forward' ? sharePlanningBoardGanttLayout(previousLayout.current, currentLayout) : currentLayout, [currentLayout]);
  useLayoutEffect(() => { previousLayout.current = sourceLayout; }, [sourceLayout]);
  // Stable row handlers must still see current callbacks and acknowledgement revisions.
  const currentBars = useMemo(() => new Map(currentLayout.groups.flatMap((group) => group.rows.flatMap((row) =>
    row.bars.map((bar) => [bar.item.itemId, bar] as const)))), [currentLayout]);
  const latest = useRef({ interaction, currentBars });
  useLayoutEffect(() => { latest.current = { interaction, currentBars }; });
  const rowActions = useMemo(() => {
    const item = (original: GrindingPlanningBoardItem) => latest.current.currentBars.get(original.itemId)?.item ?? original;
    return {
      onToggleItem: (original: GrindingPlanningBoardItem, selected: boolean) => latest.current.interaction.onToggleItem(item(original), selected),
      onTogglePin: (original: GrindingPlanningBoardItem) => latest.current.interaction.onTogglePin?.(item(original)),
      onResourceReorder: ((original, target, placement) => latest.current.interaction.onResourceReorder?.(item(original), item(target), placement)) as ForwardReorder,
      onResourceMove: ((original, resource, target, placement) => latest.current.interaction.onResourceMove?.(item(original), resource, target && item(target), placement)) as ForwardMove,
      canMoveResource: (original: GrindingPlanningBoardItem, resource: string) => latest.current.interaction.canMoveResource?.(item(original), resource) ?? false
    };
  }, []);
  // Dragging a machine name up or down reorders the lanes; the order is kept on this kiosk only.
  const nextResources = sourceLayout.groups.every((group) => group.resource) ? sourceLayout.groups.map((group) => group.resource!) : [];
  const previousResources = useRef(nextResources);
  const laneResources = nextResources.length === previousResources.current.length && nextResources.every((resource, index) => resource === previousResources.current[index])
    ? previousResources.current : nextResources;
  useLayoutEffect(() => { previousResources.current = laneResources; }, [laneResources]);
  const laneAt = useCallback((x: number, y: number) => laneAtPoint(x, y, new Set(laneResources)), [laneResources]);
  const laneOrder = usePlanningBoardPaneOrder(laneResources, preferenceScope, laneAt, Boolean(interaction.disabled), { startOnMove: true });
  const layout = useMemo(() => laneResources.length < 2 ? sourceLayout : { ...sourceLayout,
    // With both 研削 and 切削 shown, lanes move only within their own heading.
    groups: [...sourceLayout.groups].sort((a, b) => (a.category === 'cutting' ? 1 : 0) - (b.category === 'cutting' ? 1 : 0)
      || laneOrder.order.indexOf(a.resource!) - laneOrder.order.indexOf(b.resource!)) },
  [sourceLayout, laneResources, laneOrder.order]);
  const previousRowSelections = useRef(new Map<string, ReadonlySet<string>>());
  const rowSelections = useMemo(() => new Map(layout.groups.flatMap((group) => group.rows.map((row) => {
    const next = new Set(row.bars.filter((bar) => interaction.selectedItemIds.has(bar.item.itemId)).map((bar) => bar.item.itemId));
    const previous = previousRowSelections.current.get(row.key);
    const selected = next.size === 0 ? EMPTY_SELECTION
      : previous && next.size === previous.size && [...next].every((id) => previous.has(id)) ? previous : next;
    return [row.key, selected] as const;
  }))), [layout, interaction.selectedItemIds]);
  useLayoutEffect(() => { previousRowSelections.current = rowSelections; }, [rowSelections]);
  const { onPointerDown, onPointerMove, onPointerUp, onPointerCancel, onKeyDown } = laneOrder;
  const laneHandle = useCallback((resource: string, text: string, className: string) => <button type="button" title={text}
    className={clsx('touch-none select-none truncate text-left focus-visible:outline focus-visible:outline-emerald-300', className)}
    disabled={interaction.disabled} aria-label={`資源CD ${resource}の行を並べ替え`}
    aria-keyshortcuts="Alt+ArrowUp Alt+ArrowDown" onContextMenu={(event) => event.preventDefault()}
    onPointerDown={(event) => onPointerDown(event, resource)} onPointerMove={onPointerMove}
    onPointerUp={onPointerUp} onPointerCancel={onPointerCancel} onLostPointerCapture={onPointerCancel}
    onKeyDown={(event) => onKeyDown(event, resource)}>{text}</button>, [interaction.disabled, onPointerDown, onPointerMove, onPointerUp, onPointerCancel, onKeyDown]);
  const [completionTargetId, setCompletionTargetId] = useState<string | null>(null);
  useEffect(() => {
    if (completionTargetId && !planningBoardVisibleBars(layout).some((bar) => bar.item.itemId === completionTargetId)) setCompletionTargetId(null);
  }, [completionTargetId, layout]);
  const toggleCompletionTarget = useCallback((itemId: string) => {
    setCompletionTargetId((current) => current === itemId ? null : itemId);
  }, []);
  const forward = layout.mode === 'forward';
  const incomingColors = useMemo(() => {
    if (!colorBySeiban) return undefined;
    const seibans = [...new Set(planningBoardVisibleBars(layout).map((bar) => bar.item.fseiban))];
    // The legend follows the left pane's seiban priority; seibans outside it keep their first-seen order at the end.
    const rank = (seiban: string) => { const index = seibanOrder.indexOf(seiban); return index < 0 ? seibanOrder.length : index; };
    seibans.sort((a, b) => rank(a) - rank(b));
    return new Map(seibans.map((seiban) => [seiban, planningBoardSeibanColor(seiban, seibanOrder)] as const));
  }, [colorBySeiban, layout, seibanOrder]);
  const previousColors = useRef(incomingColors);
  // eslint-disable-next-line react-hooks/exhaustive-deps -- previousColors is a ref read only to keep the prior identity.
  const seibanColors = useMemo(() => JSON.stringify([...(incomingColors ?? [])]) === JSON.stringify([...(previousColors.current ?? [])]) && Boolean(incomingColors) === Boolean(previousColors.current)
    ? previousColors.current : incomingColors, [incomingColors]);
  useLayoutEffect(() => { previousColors.current = seibanColors; }, [seibanColors]);
  useEffect(() => {
    if (focusedSeiban !== null && !seibanColors?.has(focusedSeiban)) setFocusedSeiban(null);
  }, [focusedSeiban, seibanColors, setFocusedSeiban]);
  useEffect(() => {
    if (focusedSeiban === null) return;
    const clear = (event: KeyboardEvent) => { if (event.key === 'Escape') setFocusedSeiban(null); };
    document.addEventListener('keydown', clear);
    return () => document.removeEventListener('keydown', clear);
  }, [focusedSeiban, setFocusedSeiban]);
  const legend = useRef<HTMLDivElement>(null);
  const [legendHeight, setLegendHeight] = useState(0);
  const chainStrip = useRef<HTMLDivElement>(null);
  const [chainStripHeight, setChainStripHeight] = useState(0);
  const [dragPreview, setDragPreview] = useState<ForwardDragPreview | null>(null);
  const dragLanes = useMemo(() => layout.groups.flatMap((group) => group.resource
    ? [{ resource: group.resource, bars: group.rows.flatMap((row) => row.bars) }] : []), [layout]);
  const latestDragLanes = useRef(dragLanes);
  useLayoutEffect(() => { latestDragLanes.current = dragLanes; }, [dragLanes]);
  const queuePopover = useRef<ForwardQueueHandle>(null);
  const viewport = useRef<HTMLDivElement>(null);
  const pan = useRef<HTMLDivElement | null>(null);
  useEffect(() => () => pan.current?.remove(), []);
  const startPan = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.button !== 1 || event.pointerType !== 'mouse' || pan.current) return;
    event.preventDefault();
    const element = event.currentTarget;
    const { pointerId, clientX: x, clientY: y } = event;
    const left = element.scrollLeft;
    const top = element.scrollTop;
    // A small cover shows the hand: styling the viewport would restyle every bar first, which is slow on big boards.
    const cover = document.createElement('div');
    cover.dataset.planningGanttPanCover = '';
    cover.className = 'fixed inset-0 z-[90] cursor-grabbing';
    document.body.appendChild(cover);
    pan.current = cover;
    cover.setPointerCapture?.(pointerId);
    cover.addEventListener('pointermove', (move) => {
      if (move.pointerId !== pointerId || pan.current !== cover) return;
      element.scrollLeft = left - (move.clientX - x) / pageZoom();
      element.scrollTop = top - (move.clientY - y) / pageZoom();
      move.preventDefault();
    });
    const end = (stop: PointerEvent) => {
      if (stop.pointerId !== pointerId || pan.current !== cover) return;
      pan.current = null;
      cover.remove();
    };
    for (const type of ['pointerup', 'pointercancel', 'lostpointercapture'] as const) cover.addEventListener(type, end);
  };
  const content = useRef<HTMLDivElement>(null);
  const rowElements = useRef(new Map<string, HTMLDivElement>());
  const registerRow = useCallback((key: string, element: HTMLDivElement | null) => {
    if (element) rowElements.current.set(key, element); else rowElements.current.delete(key);
  }, []);
  const barRows = useMemo(() => new Map(layout.groups.flatMap((group) => group.rows.flatMap((row) =>
    row.bars.map((bar) => [bar.item.itemId, row.key] as const)))), [layout]);
  const [focusedPartKey, setFocusedPartKey] = useState<string | null>(null);
  const [currentItemId, setCurrentItemId] = useState<string | null>(null);
  const chain = useMemo(() => forward && focusedPartKey ? layout.groups.flatMap((group) => group.rows.flatMap((row) => row.bars))
    .filter((bar) => bar.partKey === focusedPartKey)
    .sort((a, b) => compareProcessOrder(a.item.processOrder, b.item.processOrder) || a.item.itemId.localeCompare(b.item.itemId)) : EMPTY_CHAIN, [forward, layout, focusedPartKey]);
  const chainPositions = useMemo(() => new Map(chain.map((bar, index) => [bar.item.itemId, index + 1])), [chain]);
  const showChain = chain.length > 0 && !interaction.pinMode;
  useEffect(() => {
    if (!showChain) { setFocusedPartKey(null); setCurrentItemId(null); }
  }, [showChain]);
  useLayoutEffect(() => {
    const element = chainStrip.current;
    if (!showChain || !element) return;
    const measure = () => setChainStripHeight(element.offsetHeight);
    measure();
    window.addEventListener('resize', measure);
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure);
    observer?.observe(element);
    return () => { window.removeEventListener('resize', measure); observer?.disconnect(); };
  }, [showChain]);
  const bottomInset = showChain ? chainStripHeight : 0;
  const focusChain = useCallback((bar: GanttBar) => {
    setFocusedPartKey((current) => current === bar.partKey ? null : bar.partKey);
    setCurrentItemId(null);
  }, []);
  // The later-queue tray and the hover queue sit in the same place, so the open tray wins.
  const laterQueueOpen = useRef(false);
  const onLaterQueueOpenChange = useCallback((open: boolean) => {
    laterQueueOpen.current = open;
    if (open) queuePopover.current?.close();
  }, []);
  const showQueue = useCallback((bar: GanttBar, anchor: HTMLButtonElement) => {
    if (!showChain && !laterQueueOpen.current) queuePopover.current?.show(latest.current.currentBars.get(bar.item.itemId) ?? bar, anchor);
  }, [showChain]);
  const leaveQueue = useCallback(() => queuePopover.current?.hideSoon(), []);
  const closeQueue = useCallback(() => queuePopover.current?.close(), []);
  const [viewportWidth, setViewportWidth] = useState(1120);
  const [viewportHeight, setViewportHeight] = useState<number | null>(null);
  const flaggedIndex = useRef(-1);
  const previousAxis = useRef<{ start: number; dayWidth: number; scale: number; forward: boolean; homeKey: number; step: number; today: number } | null>(null);
  const labelWidth = forward ? GANTT_FORWARD_LABEL_WIDTH : GANTT_LABEL_WIDTH;
  const dayWidth = Math.max(1, viewportWidth - labelWidth) / (scale === 1 ? ONE_DAY_VISIBLE_DAYS : scale);
  const width = (layout.end - layout.start) * dayWidth;
  const { window: ganttWindow, onScroll: updateWindow, measure: measureWindow } = usePlanningBoardGanttWindow(viewport, labelWidth);
  const showHours = dayWidth >= HOUR_TICK_MIN_DAY_WIDTH;
  const hourTicks = scale === 1 ? EVERY_HOUR : HOUR_TICKS;
  useLayoutEffect(() => {
    const element = viewport.current;
    if (!element) return;
    // Fill the screen down to the bottom edge instead of guessing the height of the chrome above.
    const measure = () => {
      measureWindow();
      if (element.clientWidth > 0) setViewportWidth(element.clientWidth);
      const top = element.getBoundingClientRect().top;
      setLegendHeight(legend.current?.offsetHeight ?? 0);
      if (window.innerHeight > 0) setViewportHeight(Math.max(192, Math.floor((window.innerHeight - top) / pageZoom() - GANTT_BOTTOM_GAP - (legend.current?.offsetHeight ?? 0))));
    };
    measure();
    window.addEventListener('resize', measure);
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure);
    observer?.observe(element);
    if (legend.current) observer?.observe(legend.current);
    return () => { window.removeEventListener('resize', measure); observer?.disconnect(); };
  }, [colorBySeiban, measureWindow]);
  // Before paint, so the mounted window follows the new position without a blank frame.
  useLayoutEffect(() => {
    if (!viewport.current) return;
    const previous = previousAxis.current;
    // A scale press starts near today so a 2- or 4-day span does not open on past days; data changes keep the position.
    // The one-day scale never opens before the shift starts. Backward charts open an hour before now on the hour.
    // 「今日から」 has nothing before now, so it opens ten minutes before the current ten-minute step and keeps the bars at the left edge.
    // Each new step also returns to that position, so an unattended board keeps following the clock.
    const nowMinute = ((layout.now ?? jstDay(new Date())) - layout.today) * 24 * 60;
    const stepMinutes = forward && scale === 1 ? 10 : 60;
    // Day fractions lose a little precision, so 14:00 can come out as 13:59.99…; the epsilon keeps it in the new step.
    const step = Math.floor(nowMinute / stepMinutes + 1e-6);
    const homeMinute = forward ? step * stepMinutes - 10 : (step - 1) * stepMinutes;
    const home = layout.today + (scale === 1 ? Math.max(SHIFT_START_HOUR * 60, homeMinute) / (24 * 60) : forward || scale < 7 ? 0 : -3);
    const firstDay = previous && previous.scale === scale && previous.forward === forward && previous.homeKey === homeKey && previous.step === step && previous.today === layout.today
      ? previous.start + viewport.current.scrollLeft / previous.dayWidth
      : home;
    viewport.current.scrollLeft = Math.max(0, (firstDay - layout.start) * dayWidth);
    previousAxis.current = { start: layout.start, dayWidth, scale, forward, homeKey, step, today: layout.today };
    measureWindow();
  }, [dayWidth, layout.start, layout.today, layout.now, scale, forward, homeKey, measureWindow]);
  const nudge = (direction: 1 | -1) => {
    if (viewport.current) viewport.current.scrollLeft = Math.max(0, viewport.current.scrollLeft + direction * NUDGE_DAYS * dayWidth);
  };
  useImperativeHandle(ref, () => ({ scrollToNextOverlap: () => {
    const element = viewport.current;
    const rows = layout.groups.flatMap((group) => group.rows).filter((row) => row.flagged);
    if (!element || !rows.length) return;
    flaggedIndex.current = (flaggedIndex.current + 1) % rows.length;
    const row = rows[flaggedIndex.current]!;
    const rowElement = rowElements.current.get(row.key);
    if (!rowElement) return;
    element.scrollTop += (rowElement.getBoundingClientRect().top - element.getBoundingClientRect().top) / pageZoom() - 36;
    const rect = row.bars.map((bar) => ganttBarGeometry(bar, layout.start, dayWidth, forward)).find((rect) => rect !== null);
    if (rect) element.scrollLeft = Math.max(0, rect.left - (viewportWidth - labelWidth) / 2);
    measureWindow();
  }, scrollToNextLate: () => {
    const element = viewport.current;
    const bars = forward ? planningBoardVisibleBars(layout).filter((bar) => bar.tone === 'late') : [];
    if (!element || !bars.length) return;
    flaggedIndex.current = (flaggedIndex.current + 1) % bars.length;
    const bar = bars[flaggedIndex.current]!;
    const rect = ganttBarGeometry(bar, layout.start, dayWidth, forward);
    const rowElement = rowElements.current.get(barRows.get(bar.item.itemId)!);
    if (!rowElement || !rect) return;
    element.scrollTop += (rowElement.getBoundingClientRect().top - element.getBoundingClientRect().top) / pageZoom() + rect.top - 70;
    element.scrollLeft = Math.max(0, rect.left - (viewportWidth - labelWidth) / 2);
    measureWindow();
  } }), [layout, forward, dayWidth, viewportWidth, labelWidth, barRows, measureWindow]);
  const days = useMemo(() => Array.from({ length: layout.end - layout.start }, (_, i) => {
    const day = layout.start + i;
    const weekday = new Date(day * 86_400_000).getUTCDay();
    return { day, weekday, weekend: weekday === 0 || weekday === 6 };
  }), [layout.end, layout.start]);
  const dateHeadings = useMemo(() => days.map(({ day, weekday, weekend }) => <div key={day} className={clsx('relative shrink-0 overflow-hidden whitespace-nowrap border-l border-slate-800 pt-0.5 text-center text-[11px] leading-4 tabular-nums', day === layout.today ? 'bg-emerald-400 font-bold text-slate-950' : weekend ? 'bg-slate-800 text-slate-300' : 'text-slate-300')}
              style={{ width: dayWidth }} title={dayToDate(day)}>
              {dayWidth >= 44 || weekday === 1 ? `${dayLabel(day)} ` : ''}{WEEKDAYS[weekday]}
              {showHours && hourTicks.map((hour) => <span key={hour} className="absolute bottom-0 -translate-x-1/2 text-xs font-bold leading-4 opacity-90" style={{ left: `${hour / 24 * 100}%` }}>{hour}時</span>)}
            </div>), [days, dayWidth, layout.today, showHours, hourTicks]);
  const selectedParts = useMemo(() => new Set(layout.groups.flatMap((group) => group.rows.flatMap((row) =>
    row.bars.filter((bar) => interaction.selectedItemIds.has(bar.item.itemId)).map((bar) => bar.partKey)
  ))), [interaction.selectedItemIds, layout]);
  const scrollToBar = (bar: GanttBar) => {
    const element = viewport.current;
    const rowElement = rowElements.current.get(barRows.get(bar.item.itemId)!);
    const rect = ganttBarGeometry(bar, layout.start, dayWidth, forward);
    if (!element || !rowElement || !rect) return;
    const bounds = element.getBoundingClientRect();
    // Centre the first segment, keeping its start visible when wider than the chart.
    const barLeft = labelWidth + rect.left;
    const left = Math.max(0, Math.min(barLeft + rect.width / 2 - (viewportWidth + labelWidth) / 2, barLeft - labelWidth - 16));
    const rowTop = (rowElement.getBoundingClientRect().top - bounds.top) / pageZoom() + rect.top;
    const visibleHeight = element.clientHeight || viewportHeight || bounds.height / pageZoom();
    const top = Math.max(0, element.scrollTop + rowTop - 36,
      element.scrollTop + rowTop + rect.height - visibleHeight + bottomInset);
    if (typeof element.scrollTo === 'function') element.scrollTo({ left, top, behavior: 'smooth' });
    else { element.scrollLeft = left; element.scrollTop = top; }
  };
  const scrollToStep = (bar: GanttBar) => {
    scrollToBar(bar);
    setCurrentItemId(bar.item.itemId);
  };
  // A legend chip jumps to the seiban's earliest bar, which may sit outside the visible hours.
  const focusSeiban = (seiban: string) => {
    setFocusedSeiban(seiban);
    const barStart = (bar: GanttBar) => bar.segments?.[0]?.start ?? bar.start ?? bar.end ?? Infinity;
    const first = planningBoardVisibleBars(layout).filter((bar) => bar.item.fseiban === seiban)
      .reduce<GanttBar | undefined>((earliest, bar) => !earliest || barStart(bar) < barStart(earliest) ? bar : earliest, undefined);
    if (first) scrollToBar(first);
  };
  const breaksButton = useCallback((resource: string) => <button type="button"
    className={clsx('h-7 w-9 shrink-0 whitespace-nowrap rounded border px-0 text-[13px] font-bold leading-none disabled:opacity-40',
      !runsThroughBreaks?.has(resource) ? 'border-sky-300 bg-sky-400 text-slate-950' : 'border-slate-600 bg-slate-900 text-slate-200')}
    aria-pressed={!runsThroughBreaks?.has(resource)}
    disabled={resource === '未設定' || dailyHoursByResource[resource] === 24 || capacityPending || interaction.disabled}
    onClick={() => onBreaksChange?.(resource, !runsThroughBreaks?.has(resource))}>休憩</button>, [runsThroughBreaks, dailyHoursByResource, capacityPending, interaction.disabled, onBreaksChange]);
  const resourceLabel = useCallback((resource: string, label: string) => <>
    {laneHandle(resource, ganttResourceLabel(normalizeMachineName(label), resourceNameMap[resource]), 'min-h-5 font-bold')}
    <div className="flex gap-1" role="group" aria-label={`${resource}の1日の稼働時間`}>
      {GRINDING_PLANNING_BOARD_RESOURCE_DAILY_HOURS.map((hours) => <button key={hours} type="button"
        className={clsx('h-7 w-8 shrink-0 rounded border px-0 font-mono text-[13px] font-bold leading-none',
          (dailyHoursByResource[resource] ?? GRINDING_PLANNING_BOARD_DEFAULT_RESOURCE_DAILY_HOURS) === hours ? 'border-sky-300 bg-sky-400 text-slate-950' : 'border-slate-600 bg-slate-900 text-slate-200')}
        aria-pressed={(dailyHoursByResource[resource] ?? GRINDING_PLANNING_BOARD_DEFAULT_RESOURCE_DAILY_HOURS) === hours}
        disabled={resource === '未設定' || capacityPending || interaction.disabled}
        onClick={() => onCapacityChange(resource, hours)}>{hours}H</button>)}
      {breaksButton(resource)}
    </div>
    {uptimeByResource.has(normalizeMachineName(resource)) && <div className="flex h-4 items-center gap-1.5 whitespace-nowrap leading-4" title="直近30日の1日あたり稼働時間の平均">
      <span className="text-[12px] font-bold text-slate-300">月平均</span>
      <span className="font-mono text-[15px] font-bold tabular-nums text-emerald-300">{(uptimeByResource.get(normalizeMachineName(resource))! / 3600).toFixed(1)}h</span>
    </div>}
  </>, [laneHandle, resourceNameMap, dailyHoursByResource, capacityPending, interaction.disabled, onCapacityChange, breaksButton, uptimeByResource]);
  const previousLabels = useRef<{ render: typeof resourceLabel; labels: Map<string, { text: string; node: React.ReactNode }> } | null>(null);
  const resourceLabels = useMemo(() => new Map(layout.groups.filter((group) => group.resource).map((group) => {
    const old = previousLabels.current?.render === resourceLabel ? previousLabels.current.labels.get(group.resource!) : undefined;
    return [group.resource!, old?.text === group.label ? old : { text: group.label, node: resourceLabel(group.resource!, group.label) }];
  })), [layout.groups, resourceLabel]);
  useLayoutEffect(() => { previousLabels.current = { render: resourceLabel, labels: resourceLabels }; }, [resourceLabel, resourceLabels]);
  return (
    <section aria-label="製番ボード ガント" data-testid="planning-board-gantt" className="relative mt-2 overflow-hidden rounded-lg border border-slate-800 bg-slate-900">
      {capacityError && <p role="alert" className="absolute right-0 top-0 z-40 px-2 py-1 text-xs text-rose-200">稼働時間を保存できませんでした。</p>}
      <div ref={viewport} onScroll={() => { queuePopover.current?.close(); updateWindow(); }} className="relative min-h-48 overflow-auto"
        style={{ height: viewportHeight ?? undefined, overflowAnchor: 'none', scrollPaddingBottom: `${bottomInset}px` }} tabIndex={0} aria-label="ガントの日付と工程"
        onPointerDown={startPan}
        onAuxClick={(event) => { if (event.button === 1) event.preventDefault(); }}>
        <div ref={content} className="relative isolate" style={{ width: labelWidth + width, paddingBottom: bottomInset }}>
          <div className="sticky top-0 z-30 flex h-9 border-b border-slate-700 bg-slate-950">
            {/* The ‹ › buttons sit in the top-left corner so they never cover bars. */}
            <div className="sticky left-0 z-40 flex shrink-0 items-center justify-center gap-2 bg-slate-950 px-2" style={{ width: labelWidth }} role="group" aria-label="ガントの左右送り">
              {([[-1, '2時間戻る', '‹'], [1, '2時間進む', '›']] as const).map(([direction, label, mark]) => <button key={direction} type="button" aria-label={label}
                className="grid h-8 w-16 place-items-center rounded-md border border-slate-500 bg-slate-900 pb-0.5 text-2xl font-bold leading-none text-slate-100 active:bg-sky-400 active:text-slate-950"
                onClick={() => nudge(direction)}>{mark}</button>)}
            </div>
            {dateHeadings}
          </div>
          {/* The forward chart draws no vertical grid so the brighter row lines carry the eye from the machine name to its bars. */}
          {!forward && days.map(({ day, weekend }) => <div key={day} className={clsx('pointer-events-none absolute bottom-0 top-9 border-l border-slate-800/70', weekend && 'bg-slate-950/50')}
            style={{ left: labelWidth + (day - layout.start) * dayWidth, width: dayWidth }} />)}
          {!forward && showHours && days.flatMap(({ day }) => hourTicks.map((hour) => <div key={`${day}-${hour}`} className="pointer-events-none absolute bottom-0 top-9 border-l border-dashed border-slate-700/60"
            style={{ left: labelWidth + (day - layout.start + hour / 24) * dayWidth }} />))}
          {!forward && <div className="pointer-events-none absolute bottom-0 top-9 z-[1] w-px bg-emerald-400" style={{ left: labelWidth + (layout.today - layout.start) * dayWidth }} />}
          {layout.completedOnly && <p className="sticky left-0 w-fit p-3 text-sm text-slate-400">完了は「納期から」で表示</p>}
          {layout.groups.map((group, index) => <div key={group.key} data-gantt-lane={group.resource ? '' : undefined} data-resource-code={group.resource ?? undefined}
            data-gantt-lane-resource={group.resource ?? undefined}
            style={{ opacity: dragPreview && group.resource && !dragPreview.allowed.has(group.resource) ? 0.3 : undefined,
              outline: dragPreview?.drop?.resource === group.resource && group.resource !== dragPreview?.bar.resource ? '3px solid rgb(110 231 183)' : undefined,
              outlineOffset: -3 }}>
            {interaction.resourceView && group.category && group.category !== layout.groups[index - 1]?.category && (
              <div data-testid="planning-gantt-category-header" className="relative flex h-6 bg-slate-800 text-[11px] font-bold">
                <div className="sticky left-0 z-20 flex items-center bg-slate-800 px-2" style={{ width: labelWidth }}>
                  {group.category === 'grinding' ? '研削' : '切削'}
                </div>
              </div>
            )}
            {!(forward && group.resource) && <div className="relative flex min-h-11 border-b border-slate-700 bg-slate-800">
              <div data-gantt-lane-label className="sticky left-0 z-20 flex min-h-11 shrink-0 items-center gap-1 bg-slate-800 px-2 text-xs" style={{ width: labelWidth }}>
                {group.resource ? laneHandle(group.resource, ganttResourceLabel(normalizeMachineName(group.label), resourceNameMap[group.resource]), 'min-h-11 min-w-0 flex-1 font-bold')
                  : <strong className="min-w-0 flex-1 truncate" title={group.label}>{normalizeMachineName(group.label)}</strong>}
                {group.resource && group.resource !== '未設定' && <div className="flex shrink-0 gap-1" role="group" aria-label={`${group.resource}の1日の稼働時間`}>
                  {GRINDING_PLANNING_BOARD_RESOURCE_DAILY_HOURS.map((hours) => <button key={hours} type="button"
                    className={clsx('h-7 w-8 shrink-0 rounded border px-0 font-mono text-[13px] font-bold leading-none',
                      (dailyHoursByResource[group.resource!] ?? GRINDING_PLANNING_BOARD_DEFAULT_RESOURCE_DAILY_HOURS) === hours ? 'border-sky-300 bg-sky-400 text-slate-950' : 'border-slate-600 bg-slate-900 text-slate-200')}
                    aria-pressed={(dailyHoursByResource[group.resource!] ?? GRINDING_PLANNING_BOARD_DEFAULT_RESOURCE_DAILY_HOURS) === hours}
                    disabled={capacityPending || interaction.disabled}
                    onClick={() => onCapacityChange(group.resource!, hours)}>{hours}H</button>)}
                  {breaksButton(group.resource)}
                </div>}
              </div>
            </div>}
            <div className="relative">
            {forward ? group.rows.map((row) => {
              return <PlanningBoardForwardGanttRow window={ganttWindow} registerRow={registerRow} seibanColors={seibanColors} focusedSeiban={focusedSeiban} key={row.key} row={row} chipsByPart={chipsByPart} placementByPart={placementByPart} start={layout.start} end={layout.end} now={layout.now!} width={width} dayWidth={dayWidth} scale={scale}
                onShowQueue={showQueue} onLeaveQueue={leaveQueue} onCloseQueue={closeQueue}
                pausesForBreaks={group.resource ? !runsThroughBreaks?.has(group.resource) : row.bars.some((bar) => !runsThroughBreaks?.has(bar.resource))}
                hours={group.resource ? dailyHoursByResource[group.resource] ?? GRINDING_PLANNING_BOARD_DEFAULT_RESOURCE_DAILY_HOURS : Math.max(...row.bars.map((bar) => dailyHoursByResource[bar.resource] ?? GRINDING_PLANNING_BOARD_DEFAULT_RESOURCE_DAILY_HOURS), GRINDING_PLANNING_BOARD_DEFAULT_RESOURCE_DAILY_HOURS)}
                selectedItemIds={rowSelections.get(row.key) ?? EMPTY_SELECTION} disabled={interaction.disabled} dragDisabled={interaction.dragDisabled}
                pinMode={interaction.pinMode} resourceView={interaction.resourceView} {...rowActions}
                lanes={latestDragLanes}
                draggedItemId={dragPreview && row.bars.some((bar) => bar.item.itemId === dragPreview.bar.item.itemId) ? dragPreview.bar.item.itemId : null}
                insertionLeft={dragPreview?.drop && dragPreview.drop.resource === group.resource ? dragPreview.drop.left : null} onDragPreview={setDragPreview}
                focusedPartKey={showChain ? focusedPartKey : null} chainPositions={chainPositions} onFocusChain={focusChain}
                label={group.resource ? resourceLabels.get(group.resource)?.node : undefined} />;
            }) : group.rows.map((row) => <PlanningBoardGanttRow window={ganttWindow} registerRow={registerRow} seibanColors={seibanColors} focusedSeiban={focusedSeiban} key={row.key} row={row} start={layout.start} width={width} dayWidth={dayWidth}
              completionTargetId={completionTargetId} onCompletionTarget={toggleCompletionTarget} onCompleteToggle={onCompleteToggle} completionPendingRowIds={completionPendingRowIds}
              today={dayToDate(layout.today)} selectedParts={selectedParts} {...interaction} />)}
            {forward && group.resource && <div data-later-queue-host={`column-${dragLanes.findIndex((lane) => lane.resource === group.resource)}`}
              className="pointer-events-none absolute inset-0 flex items-stretch justify-end" />}
            </div>
            {forward && group.resource && <div data-later-queue-host={`tray-${dragLanes.findIndex((lane) => lane.resource === group.resource)}`} />}
          </div>)}
          {forward && <PlanningBoardForwardLaterQueue viewport={viewport} lanes={dragLanes} start={layout.start} dayWidth={dayWidth}
            labelWidth={labelWidth} viewportWidth={viewportWidth} disabled={interaction.disabled || interaction.dragDisabled || Boolean(interaction.pinMode) || !interaction.resourceView}
            onDragPreview={setDragPreview} onOpenChange={onLaterQueueOpenChange} {...rowActions} />}
          {showChain && <PlanningBoardChainLinks bars={chain} content={content} rowElements={rowElements} barRows={barRows} labelWidth={labelWidth} layout={layout} dayWidth={dayWidth} viewportWidth={viewportWidth} viewportHeight={viewportHeight} />}
        </div>
      </div>
      {showChain && <PlanningBoardChainStrip ref={chainStrip} bottom={legendHeight} bars={chain} resourceNameMap={resourceNameMap} currentItemId={currentItemId}
        onCompleteToggle={onCompleteToggle} completionPendingRowIds={completionPendingRowIds} disabled={interaction.disabled}
        onStep={scrollToStep} onClose={() => setFocusedPartKey(null)} />}
      {seibanColors && <div ref={legend} role="group" aria-label="製番の色分け凡例" className="flex max-h-[52px] snap-y snap-mandatory scroll-pt-1 flex-wrap gap-2 overflow-y-auto overscroll-contain border-t border-slate-700 px-2 py-1 text-xs text-slate-200">
        {[...seibanColors].map(([seiban, color]) => <button key={seiban} type="button" aria-pressed={focusedSeiban === seiban}
          onClick={() => focusedSeiban === seiban ? setFocusedSeiban(null) : focusSeiban(seiban)}
          className={clsx('inline-flex min-h-[44px] snap-start items-center gap-1 rounded bg-slate-800 px-1.5 py-1 font-mono focus-visible:outline focus-visible:outline-2 focus-visible:outline-emerald-300', focusedSeiban === seiban && 'ring-2 ring-white')}>
          <span className={clsx('h-3 w-3 rounded-sm', color)} />{seiban}
        </button>)}
        {focusedSeiban !== null && <button type="button" onClick={() => setFocusedSeiban(null)}
          className="min-h-[44px] snap-start rounded bg-slate-800 px-2 py-1 focus-visible:outline focus-visible:outline-2 focus-visible:outline-emerald-300">すべて表示</button>}
      </div>}
      {forward && <PlanningBoardForwardQueuePopover ref={queuePopover} layout={currentLayout} scale={scale} resourceNameMap={resourceNameMap} {...interaction} dragDisabled={interaction.dragDisabled || Boolean(interaction.pinMode)} />}
      {dragPreview && createPortal(<div data-testid="planning-gantt-drag-ghost"
        className="pointer-events-none fixed z-[100] rounded border-2 border-amber-400 bg-slate-950 px-2 py-1 text-[13px] text-slate-100"
        style={{ left: dragPreview.x / pageZoom() + 12, top: dragPreview.y / pageZoom() + 12 }}>
        <strong className="font-mono">{dragPreview.bar.resource}</strong> {dragPreview.bar.item.fhinmei || dragPreview.bar.item.fhincd}
      </div>, document.body)}
    </section>
  );
});
