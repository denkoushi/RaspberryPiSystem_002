import { GRINDING_PLANNING_BOARD_RESOURCE_DAILY_HOURS, GRINDING_PLANNING_BOARD_DEFAULT_RESOURCE_DAILY_HOURS } from '@raspi-system/shared-types';
import clsx from 'clsx';
import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';

import { normalizeMachineName } from '../../productionSchedule/machineName';

import { ganttResourceLabel } from './ganttResourceLabel';
import { PlanningBoardForwardGanttRow } from './PlanningBoardForwardGanttRow';
import { PlanningBoardForwardQueuePopover } from './PlanningBoardForwardQueuePopover';
import { dayLabel, dayToDate, jstDay } from './planningBoardGanttLayout';
import { GANTT_FORWARD_LABEL_WIDTH, GANTT_HATCH, GANTT_LABEL_WIDTH, PlanningBoardGanttRow } from './PlanningBoardGanttRow';

import type { ForwardReorder } from './PlanningBoardForwardGanttRow';
import type { ForwardQueueHandle } from './PlanningBoardForwardQueuePopover';
import type { GanttLayout } from './planningBoardGanttLayout';
import type { PlanningBoardGanttRowProps } from './PlanningBoardGanttRow';
import type { GrindingPlanningBoardResourceDailyHours } from '@raspi-system/shared-types';

type Props = Pick<PlanningBoardGanttRowProps, 'disabled' | 'dragDisabled' | 'onToggleItem' | 'onDueDrop' | 'selectedItemIds' | 'resourceView'> & {
  onResourceReorder?: ForwardReorder;
  layout: GanttLayout;
  scale: number;
  /** Changes each time a scale button is pressed, so the chart returns to today even on the current scale. */
  homeKey?: number;
  dailyHoursByResource: Readonly<Record<string, GrindingPlanningBoardResourceDailyHours>>;
  resourceNameMap: Record<string, string[]>;
  capacityPending: boolean;
  capacityError: boolean;
  onCapacityChange: (resourceCd: string, dailyHours: GrindingPlanningBoardResourceDailyHours) => void;
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

export const PlanningBoardGanttView = forwardRef<PlanningBoardGanttHandle, Props>(function PlanningBoardGanttView({
  layout, scale, homeKey = 0, dailyHoursByResource, resourceNameMap, capacityPending, capacityError, onCapacityChange, ...interaction
}, ref) {
  const forward = layout.mode === 'forward';
  const queuePopover = useRef<ForwardQueueHandle>(null);
  const viewport = useRef<HTMLDivElement>(null);
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
  }, []);
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
  const resourceLabel = (resource: string, label: string) => <>
    <strong className="truncate" title={label}>{ganttResourceLabel(normalizeMachineName(label), resourceNameMap[resource])}</strong>
    <div className="flex gap-1" role="group" aria-label={`${resource}の1日の稼働時間`}>
      {GRINDING_PLANNING_BOARD_RESOURCE_DAILY_HOURS.map((hours) => <button key={hours} type="button"
        className={clsx('h-7 min-w-10 rounded border px-1 font-mono text-[13px] font-bold leading-none',
          (dailyHoursByResource[resource] ?? GRINDING_PLANNING_BOARD_DEFAULT_RESOURCE_DAILY_HOURS) === hours ? 'border-sky-300 bg-sky-400 text-slate-950' : 'border-slate-600 bg-slate-900 text-slate-200')}
        aria-pressed={(dailyHoursByResource[resource] ?? GRINDING_PLANNING_BOARD_DEFAULT_RESOURCE_DAILY_HOURS) === hours}
        disabled={resource === '未設定' || capacityPending || interaction.disabled}
        onClick={() => onCapacityChange(resource, hours)}>{hours}H</button>)}
    </div>
  </>;
  return (
    <section aria-label="製番ボード ガント" data-testid="planning-board-gantt" className="relative mt-2 overflow-hidden rounded-lg border border-slate-800 bg-slate-900">
      {capacityError && <p role="alert" className="px-2 py-1 text-xs text-rose-200">稼働時間を保存できませんでした。</p>}
      <div ref={viewport} onScroll={() => queuePopover.current?.close()} className="relative min-h-48 overflow-auto" style={viewportHeight ? { height: viewportHeight } : undefined} tabIndex={0} aria-label="ガントの日付と工程">
        <div className="relative isolate" style={{ width: labelWidth + width }}>
          <div className="sticky top-0 z-30 flex h-9 border-b border-slate-700 bg-slate-950">
            <div className="sticky left-0 z-40 flex shrink-0 flex-wrap items-center gap-x-3 bg-slate-950 px-2 text-[10px] text-slate-300" style={{ width: labelWidth }}>
              <span><i className="mr-1 inline-block h-2 w-4 rounded bg-sky-400" />予定</span>
              <span><i className="mr-1 inline-block h-2 w-4 rounded bg-rose-400" />{forward ? '遅れ見込み' : '納期超過'}</span>
              {forward ? <><span className="text-amber-300">┄ 前工程待ち</span><span className="text-yellow-300">│ 今</span></> : <>
                <span><i className="mr-1 inline-block h-2 w-4 rounded" style={{ background: GANTT_HATCH }} />工程の重なり</span>
                <span><i className="mr-1 inline-block h-2 w-4 rounded bg-slate-600" />完了</span></>}
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
          {layout.groups.map((group) => <div key={group.key}>
            {!(forward && group.resource) && <div className="relative flex min-h-11 border-b border-slate-700 bg-slate-800">
              <div className="sticky left-0 z-20 flex min-h-11 shrink-0 items-center gap-1 bg-slate-800 px-2 text-xs" style={{ width: labelWidth }}>
                <strong className="min-w-0 flex-1 truncate" title={group.label}>{group.resource ? ganttResourceLabel(normalizeMachineName(group.label), resourceNameMap[group.resource]) : normalizeMachineName(group.label)}</strong>
                {group.resource && group.resource !== '未設定' && <div className="flex shrink-0 gap-1" role="group" aria-label={`${group.resource}の1日の稼働時間`}>
                  {GRINDING_PLANNING_BOARD_RESOURCE_DAILY_HOURS.map((hours) => <button key={hours} type="button"
                    className={clsx('h-7 min-w-10 rounded border px-1 font-mono text-[13px] font-bold leading-none',
                      (dailyHoursByResource[group.resource!] ?? GRINDING_PLANNING_BOARD_DEFAULT_RESOURCE_DAILY_HOURS) === hours ? 'border-sky-300 bg-sky-400 text-slate-950' : 'border-slate-600 bg-slate-900 text-slate-200')}
                    aria-pressed={(dailyHoursByResource[group.resource!] ?? GRINDING_PLANNING_BOARD_DEFAULT_RESOURCE_DAILY_HOURS) === hours}
                    disabled={capacityPending || interaction.disabled}
                    onClick={() => onCapacityChange(group.resource!, hours)}>{hours}H</button>)}
                </div>}
              </div>
            </div>}
            {forward ? group.rows.map((row) => {
              return <PlanningBoardForwardGanttRow key={row.key} row={row} start={layout.start} end={layout.end} now={layout.now!} width={width} dayWidth={dayWidth} scale={scale}
                onShowQueue={(bar, anchor) => queuePopover.current?.show(bar, anchor)}
                onLeaveQueue={() => queuePopover.current?.hideSoon()} onCloseQueue={() => queuePopover.current?.close()}
                hours={group.resource ? dailyHoursByResource[group.resource] ?? GRINDING_PLANNING_BOARD_DEFAULT_RESOURCE_DAILY_HOURS : Math.max(...row.bars.map((bar) => dailyHoursByResource[bar.resource] ?? GRINDING_PLANNING_BOARD_DEFAULT_RESOURCE_DAILY_HOURS), GRINDING_PLANNING_BOARD_DEFAULT_RESOURCE_DAILY_HOURS)}
                {...interaction}
                label={group.resource ? resourceLabel(group.resource, group.label) : undefined} />;
            }) : group.rows.map((row) => <PlanningBoardGanttRow key={row.key} row={row} start={layout.start} width={width} dayWidth={dayWidth}
              today={dayToDate(layout.today)} selectedParts={selectedParts} {...interaction} />)}
          </div>)}
        </div>
      </div>
      <div className="absolute bottom-5 right-3 z-40 flex gap-1.5" role="group" aria-label="ガントの左右送り">
        {([[-1, '2時間戻る', '‹'], [1, '2時間進む', '›']] as const).map(([direction, label, mark]) => <button key={direction} type="button" aria-label={label}
          className="grid h-12 w-12 place-items-center rounded-full border border-slate-500 bg-slate-900/85 pb-0.5 text-2xl font-bold leading-none text-slate-100 shadow-lg shadow-black/50 active:bg-sky-400 active:text-slate-950"
          onClick={() => nudge(direction)}>{mark}</button>)}
      </div>
      {forward && <PlanningBoardForwardQueuePopover ref={queuePopover} layout={layout} scale={scale} resourceNameMap={resourceNameMap} {...interaction} />}
    </section>
  );
});
