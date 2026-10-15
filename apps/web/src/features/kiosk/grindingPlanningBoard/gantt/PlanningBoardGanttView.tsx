import { GRINDING_PLANNING_BOARD_RESOURCE_DAILY_HOURS, GRINDING_PLANNING_BOARD_DEFAULT_RESOURCE_DAILY_HOURS } from '@raspi-system/shared-types';
import clsx from 'clsx';
import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';

import { normalizeMachineName } from '../../productionSchedule/machineName';
import { compareProcessOrder } from '../sortGrindingPlanningBoardItems';
import { usePlanningBoardPaneOrder } from '../usePlanningBoardPaneOrder';

import { ganttResourceLabel } from './ganttResourceLabel';
import { chainBarElement, PlanningBoardChainLinks } from './PlanningBoardChainLinks';
import { PlanningBoardChainStrip } from './PlanningBoardChainStrip';
import { PlanningBoardForwardGanttRow } from './PlanningBoardForwardGanttRow';
import { PlanningBoardForwardQueuePopover } from './PlanningBoardForwardQueuePopover';
import { dayLabel, dayToDate, jstDay } from './planningBoardGanttLayout';
import { GANTT_FORWARD_LABEL_WIDTH, GANTT_LABEL_WIDTH, PlanningBoardGanttRow } from './PlanningBoardGanttRow';

import type { ForwardReorder } from './PlanningBoardForwardGanttRow';
import type { ForwardQueueHandle } from './PlanningBoardForwardQueuePopover';
import type { GanttBar, GanttLayout } from './planningBoardGanttLayout';
import type { PlanningBoardGanttRowProps } from './PlanningBoardGanttRow';
import type { GrindingPlanningBoardItem, GrindingPlanningBoardResourceDailyHours } from '@raspi-system/shared-types';

type Props = Pick<PlanningBoardGanttRowProps, 'disabled' | 'dragDisabled' | 'onToggleItem' | 'onDueDrop' | 'selectedItemIds' | 'resourceView'> & {
  onResourceReorder?: ForwardReorder;
  pinMode?: boolean;
  onTogglePin?: (item: GrindingPlanningBoardItem) => void;
  runsThroughBreaks?: ReadonlySet<string>;
  onBreaksChange?: (resourceCd: string, runsThroughBreaks: boolean) => void;
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
const WEEKDAYS = ['日', '月', '火', '水', '木', '金', '土'];
const GANTT_BOTTOM_GAP = 10;
// With a 2- or 4-day span a day is wide enough to show where the hours fall.
const HOUR_TICKS = [8, 17, 20];
// The one-day scale fits ten hours on screen so short jobs stay readable, with a tick every hour.
const ONE_DAY_VISIBLE_DAYS = 10 / 24;
const EVERY_HOUR = Array.from({ length: 24 }, (_, hour) => hour);
const SHIFT_START_HOUR = 8;
const HOUR_TICK_MIN_DAY_WIDTH = 160;
// The ‹ › buttons move the chart by two hours at any scale.
const NUDGE_DAYS = 2 / 24;

function laneAtPoint(x: number, y: number, resources: ReadonlySet<string>): HTMLElement | null {
  const elements = typeof document.elementsFromPoint === 'function' ? document.elementsFromPoint(x, y) : [];
  for (const element of elements) {
    const lane = element.closest<HTMLElement>('[data-gantt-lane]');
    if (lane?.dataset.resourceCode && resources.has(lane.dataset.resourceCode)) return lane;
  }
  return null;
}

export const PlanningBoardGanttView = forwardRef<PlanningBoardGanttHandle, Props>(function PlanningBoardGanttView({
  layout: sourceLayout, scale, homeKey = 0, dailyHoursByResource, resourceNameMap, capacityPending, capacityError, onCapacityChange, runsThroughBreaks, onBreaksChange,
  preferenceScope = 'default', ...interaction
}, ref) {
  // Dragging a machine name up or down reorders the lanes; the order is kept on this kiosk only.
  const laneResources = useMemo(() => sourceLayout.groups.every((group) => group.resource)
    ? sourceLayout.groups.map((group) => group.resource!) : [], [sourceLayout]);
  const laneAt = useCallback((x: number, y: number) => laneAtPoint(x, y, new Set(laneResources)), [laneResources]);
  const laneOrder = usePlanningBoardPaneOrder(laneResources, preferenceScope, laneAt, Boolean(interaction.disabled), { startOnMove: true });
  const layout = useMemo(() => laneResources.length < 2 ? sourceLayout : { ...sourceLayout,
    // With both 研削 and 切削 shown, lanes move only within their own heading.
    groups: [...sourceLayout.groups].sort((a, b) => (a.category === 'cutting' ? 1 : 0) - (b.category === 'cutting' ? 1 : 0)
      || laneOrder.order.indexOf(a.resource!) - laneOrder.order.indexOf(b.resource!)) },
  [sourceLayout, laneResources, laneOrder.order]);
  const laneHandle = (resource: string, text: string, className: string) => <button type="button" title={text}
    className={clsx('touch-none select-none truncate text-left focus-visible:outline focus-visible:outline-emerald-300', className)}
    disabled={interaction.disabled} aria-label={`資源CD ${resource}の行を並べ替え`}
    aria-keyshortcuts="Alt+ArrowUp Alt+ArrowDown" onContextMenu={(event) => event.preventDefault()}
    onPointerDown={(event) => laneOrder.onPointerDown(event, resource)} onPointerMove={laneOrder.onPointerMove}
    onPointerUp={laneOrder.onPointerUp} onPointerCancel={laneOrder.onPointerCancel} onLostPointerCapture={laneOrder.onPointerCancel}
    onKeyDown={(event) => laneOrder.onKeyDown(event, resource)}>{text}</button>;
  const forward = layout.mode === 'forward';
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
      element.scrollLeft = left - (move.clientX - x);
      element.scrollTop = top - (move.clientY - y);
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
  const [focusedPartKey, setFocusedPartKey] = useState<string | null>(null);
  const [currentItemId, setCurrentItemId] = useState<string | null>(null);
  const chain = useMemo(() => forward ? layout.groups.flatMap((group) => group.rows.flatMap((row) => row.bars))
    .filter((bar) => bar.partKey === focusedPartKey)
    .sort((a, b) => compareProcessOrder(a.item.processOrder, b.item.processOrder) || a.item.itemId.localeCompare(b.item.itemId)) : [], [forward, layout, focusedPartKey]);
  const chainPositions = useMemo(() => new Map(chain.map((bar, index) => [bar.item.itemId, index + 1])), [chain]);
  const showChain = chain.length > 0 && !interaction.pinMode;
  useEffect(() => {
    if (!showChain) { setFocusedPartKey(null); setCurrentItemId(null); }
  }, [showChain]);
  const focusChain = (bar: GanttBar) => {
    setFocusedPartKey(focusedPartKey === bar.partKey ? null : bar.partKey);
    setCurrentItemId(null);
  };
  const [viewportWidth, setViewportWidth] = useState(1120);
  const [viewportHeight, setViewportHeight] = useState<number | null>(null);
  const flaggedIndex = useRef(-1);
  const previousAxis = useRef<{ start: number; dayWidth: number; scale: number; forward: boolean; homeKey: number; hour: number; today: number } | null>(null);
  const labelWidth = forward ? GANTT_FORWARD_LABEL_WIDTH : GANTT_LABEL_WIDTH;
  const dayWidth = Math.max(1, viewportWidth - labelWidth) / (scale === 1 ? ONE_DAY_VISIBLE_DAYS : scale);
  const width = (layout.end - layout.start) * dayWidth;
  const showHours = dayWidth >= HOUR_TICK_MIN_DAY_WIDTH;
  const hourTicks = scale === 1 ? EVERY_HOUR : HOUR_TICKS;
  useEffect(() => {
    const element = viewport.current;
    if (!element) return;
    // Fill the screen down to the bottom edge instead of guessing the height of the chrome above.
    const measure = () => {
      if (element.clientWidth > 0) setViewportWidth(element.clientWidth);
      const top = element.getBoundingClientRect().top;
      if (window.innerHeight > 0) setViewportHeight(Math.max(192, Math.floor(window.innerHeight - top - GANTT_BOTTOM_GAP)));
    };
    measure();
    window.addEventListener('resize', measure);
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure);
    observer?.observe(element);
    return () => { window.removeEventListener('resize', measure); observer?.disconnect(); };
  }, [showChain]);
  useEffect(() => {
    if (!viewport.current) return;
    const previous = previousAxis.current;
    // A scale press starts near today so a 2- or 4-day span does not open on past days; data changes keep the position.
    // The ten-hour day starts an hour before now on the hour, never before the shift starts.
    // Each new hour also returns to that position, so an unattended board keeps following the clock.
    const nowHour = ((layout.now ?? jstDay(new Date())) - layout.today) * 24;
    // Day fractions lose a little precision, so 14:00 can come out as 13.999…; the epsilon keeps it in the new hour.
    const hour = Math.floor(nowHour + 1e-6);
    const home = layout.today + (scale === 1 ? Math.max(SHIFT_START_HOUR, hour - 1) / 24 : forward || scale < 7 ? 0 : -3);
    const firstDay = previous && previous.scale === scale && previous.forward === forward && previous.homeKey === homeKey && previous.hour === hour && previous.today === layout.today
      ? previous.start + viewport.current.scrollLeft / previous.dayWidth
      : home;
    viewport.current.scrollLeft = Math.max(0, (firstDay - layout.start) * dayWidth);
    previousAxis.current = { start: layout.start, dayWidth, scale, forward, homeKey, hour, today: layout.today };
  }, [dayWidth, layout.start, layout.today, layout.now, scale, forward, homeKey]);
  const nudge = (direction: 1 | -1) => {
    if (viewport.current) viewport.current.scrollLeft = Math.max(0, viewport.current.scrollLeft + direction * NUDGE_DAYS * dayWidth);
  };
  useImperativeHandle(ref, () => ({ scrollToNextOverlap: () => {
    const element = viewport.current;
    const rows = element?.querySelectorAll<HTMLElement>('[data-gantt-flagged="true"]');
    if (!element || !rows?.length) return;
    flaggedIndex.current = (flaggedIndex.current + 1) % rows.length;
    const row = rows[flaggedIndex.current]!;
    element.scrollTop += row.getBoundingClientRect().top - element.getBoundingClientRect().top - 36;
    const bar = row.querySelector<HTMLElement>('[data-testid^="planning-gantt-bar-"]');
    if (bar) element.scrollLeft = Math.max(0, parseFloat(bar.style.left) - (viewportWidth - labelWidth) / 2);
  }, scrollToNextLate: () => {
    const element = viewport.current;
    const bars = element?.querySelectorAll<HTMLElement>('[data-gantt-late="true"]');
    if (!element || !bars?.length) return;
    flaggedIndex.current = (flaggedIndex.current + 1) % bars.length;
    const bar = bars[flaggedIndex.current]!;
    element.scrollTop += bar.getBoundingClientRect().top - element.getBoundingClientRect().top - 70;
    element.scrollLeft = Math.max(0, parseFloat(bar.style.left) - (viewportWidth - labelWidth) / 2);
  } }), [viewportWidth, labelWidth]);
  const days = useMemo(() => Array.from({ length: layout.end - layout.start }, (_, i) => {
    const day = layout.start + i;
    const weekday = new Date(day * 86_400_000).getUTCDay();
    return { day, weekday, weekend: weekday === 0 || weekday === 6 };
  }), [layout.end, layout.start]);
  const selectedParts = useMemo(() => new Set(layout.groups.flatMap((group) => group.rows.flatMap((row) =>
    row.bars.filter((bar) => interaction.selectedItemIds.has(bar.item.itemId)).map((bar) => bar.partKey)
  ))), [interaction.selectedItemIds, layout]);
  const scrollToStep = (bar: GanttBar) => {
    const element = viewport.current;
    const target = content.current && chainBarElement(content.current, bar);
    if (!element || !target) return;
    const bounds = element.getBoundingClientRect();
    const rect = target.getBoundingClientRect();
    const left = Math.max(0, element.scrollLeft + rect.left + rect.width / 2 - bounds.left - (viewportWidth + labelWidth) / 2);
    const top = Math.max(0, element.scrollTop + rect.top - bounds.top - 36);
    if (typeof element.scrollTo === 'function') element.scrollTo({ left, top, behavior: 'smooth' });
    else { element.scrollLeft = left; element.scrollTop = top; }
    setCurrentItemId(bar.item.itemId);
  };
  const breaksButton = (resource: string) => <button type="button"
    className={clsx('h-7 w-9 shrink-0 whitespace-nowrap rounded border px-0 text-[13px] font-bold leading-none disabled:opacity-40',
      !runsThroughBreaks?.has(resource) ? 'border-sky-300 bg-sky-400 text-slate-950' : 'border-slate-600 bg-slate-900 text-slate-200')}
    aria-pressed={!runsThroughBreaks?.has(resource)}
    disabled={resource === '未設定' || dailyHoursByResource[resource] === 24 || capacityPending || interaction.disabled}
    onClick={() => onBreaksChange?.(resource, !runsThroughBreaks?.has(resource))}>休憩</button>;
  const resourceLabel = (resource: string, label: string) => <>
    {laneHandle(resource, ganttResourceLabel(normalizeMachineName(label), resourceNameMap[resource]), 'min-h-7 font-bold')}
    <div className="flex gap-1" role="group" aria-label={`${resource}の1日の稼働時間`}>
      {GRINDING_PLANNING_BOARD_RESOURCE_DAILY_HOURS.map((hours) => <button key={hours} type="button"
        className={clsx('h-7 w-8 shrink-0 rounded border px-0 font-mono text-[13px] font-bold leading-none',
          (dailyHoursByResource[resource] ?? GRINDING_PLANNING_BOARD_DEFAULT_RESOURCE_DAILY_HOURS) === hours ? 'border-sky-300 bg-sky-400 text-slate-950' : 'border-slate-600 bg-slate-900 text-slate-200')}
        aria-pressed={(dailyHoursByResource[resource] ?? GRINDING_PLANNING_BOARD_DEFAULT_RESOURCE_DAILY_HOURS) === hours}
        disabled={resource === '未設定' || capacityPending || interaction.disabled}
        onClick={() => onCapacityChange(resource, hours)}>{hours}H</button>)}
      {breaksButton(resource)}
    </div>
  </>;
  return (
    <section aria-label="製番ボード ガント" data-testid="planning-board-gantt" className="relative mt-2 overflow-hidden rounded-lg border border-slate-800 bg-slate-900">
      {capacityError && <p role="alert" className="px-2 py-1 text-xs text-rose-200">稼働時間を保存できませんでした。</p>}
      {showChain && <PlanningBoardChainStrip bars={chain} resourceNameMap={resourceNameMap} currentItemId={currentItemId}
        onStep={scrollToStep} onClose={() => setFocusedPartKey(null)} />}
      <div ref={viewport} onScroll={() => queuePopover.current?.close()} className="relative min-h-48 overflow-auto"
        style={{ height: viewportHeight ?? undefined }} tabIndex={0} aria-label="ガントの日付と工程"
        onPointerDown={startPan}
        onAuxClick={(event) => { if (event.button === 1) event.preventDefault(); }}>
        <div ref={content} className="relative isolate" style={{ width: labelWidth + width }}>
          <div className="sticky top-0 z-30 flex h-9 border-b border-slate-700 bg-slate-950">
            {/* The ‹ › buttons sit in the top-left corner so they never cover bars. */}
            <div className="sticky left-0 z-40 flex shrink-0 items-center justify-center gap-2 bg-slate-950 px-2" style={{ width: labelWidth }} role="group" aria-label="ガントの左右送り">
              {([[-1, '2時間戻る', '‹'], [1, '2時間進む', '›']] as const).map(([direction, label, mark]) => <button key={direction} type="button" aria-label={label}
                className="grid h-8 w-16 place-items-center rounded-md border border-slate-500 bg-slate-900 pb-0.5 text-2xl font-bold leading-none text-slate-100 active:bg-sky-400 active:text-slate-950"
                onClick={() => nudge(direction)}>{mark}</button>)}
            </div>
            {days.map(({ day, weekday, weekend }) => <div key={day} className={clsx('relative shrink-0 overflow-hidden whitespace-nowrap border-l border-slate-800 pt-0.5 text-center text-[11px] leading-4 tabular-nums', day === layout.today ? 'bg-emerald-400 font-bold text-slate-950' : weekend ? 'bg-slate-800 text-slate-300' : 'text-slate-300')}
              style={{ width: dayWidth }} title={dayToDate(day)}>
              {dayWidth >= 44 || weekday === 1 ? `${dayLabel(day)} ` : ''}{WEEKDAYS[weekday]}
              {showHours && hourTicks.map((hour) => <span key={hour} className="absolute bottom-0 -translate-x-1/2 text-xs font-bold leading-4 opacity-90" style={{ left: `${hour / 24 * 100}%` }}>{hour}時</span>)}
            </div>)}
          </div>
          {/* The forward chart draws no vertical grid so the brighter row lines carry the eye from the machine name to its bars. */}
          {!forward && days.map(({ day, weekend }) => <div key={day} className={clsx('pointer-events-none absolute bottom-0 top-9 border-l border-slate-800/70', weekend && 'bg-slate-950/50')}
            style={{ left: labelWidth + (day - layout.start) * dayWidth, width: dayWidth }} />)}
          {!forward && showHours && days.flatMap(({ day }) => hourTicks.map((hour) => <div key={`${day}-${hour}`} className="pointer-events-none absolute bottom-0 top-9 border-l border-dashed border-slate-700/60"
            style={{ left: labelWidth + (day - layout.start + hour / 24) * dayWidth }} />))}
          {!forward && <div className="pointer-events-none absolute bottom-0 top-9 z-[1] w-px bg-emerald-400" style={{ left: labelWidth + (layout.today - layout.start) * dayWidth }} />}
          {layout.completedOnly && <p className="sticky left-0 w-fit p-3 text-sm text-slate-400">完了は「納期から」で表示</p>}
          {layout.groups.map((group, index) => <div key={group.key} data-gantt-lane={group.resource ? '' : undefined} data-resource-code={group.resource ?? undefined}>
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
            {forward ? group.rows.map((row) => {
              return <PlanningBoardForwardGanttRow key={row.key} row={row} start={layout.start} end={layout.end} now={layout.now!} width={width} dayWidth={dayWidth} scale={scale}
                onShowQueue={(bar, anchor) => queuePopover.current?.show(bar, anchor)}
                onLeaveQueue={() => queuePopover.current?.hideSoon()} onCloseQueue={() => queuePopover.current?.close()}
                pausesForBreaks={group.resource ? !runsThroughBreaks?.has(group.resource) : row.bars.some((bar) => !runsThroughBreaks?.has(bar.resource))}
                hours={group.resource ? dailyHoursByResource[group.resource] ?? GRINDING_PLANNING_BOARD_DEFAULT_RESOURCE_DAILY_HOURS : Math.max(...row.bars.map((bar) => dailyHoursByResource[bar.resource] ?? GRINDING_PLANNING_BOARD_DEFAULT_RESOURCE_DAILY_HOURS), GRINDING_PLANNING_BOARD_DEFAULT_RESOURCE_DAILY_HOURS)}
                {...interaction}
                focusedPartKey={showChain ? focusedPartKey : null} chainPositions={chainPositions} onFocusChain={focusChain}
                label={group.resource ? resourceLabel(group.resource, group.label) : undefined} />;
            }) : group.rows.map((row) => <PlanningBoardGanttRow key={row.key} row={row} start={layout.start} width={width} dayWidth={dayWidth}
              today={dayToDate(layout.today)} selectedParts={selectedParts} {...interaction} />)}
          </div>)}
          {showChain && <PlanningBoardChainLinks bars={chain} content={content} layout={layout} dayWidth={dayWidth} viewportWidth={viewportWidth} viewportHeight={viewportHeight} />}
        </div>
      </div>
      {forward && <PlanningBoardForwardQueuePopover ref={queuePopover} layout={layout} scale={scale} resourceNameMap={resourceNameMap} {...interaction} dragDisabled={interaction.dragDisabled || Boolean(interaction.pinMode)} />}
    </section>
  );
});
