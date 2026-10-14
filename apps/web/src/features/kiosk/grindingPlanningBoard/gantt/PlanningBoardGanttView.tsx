import { GRINDING_PLANNING_BOARD_RESOURCE_DAILY_HOURS, GRINDING_PLANNING_BOARD_DEFAULT_RESOURCE_DAILY_HOURS } from '@raspi-system/shared-types';
import clsx from 'clsx';
import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';

import { normalizeMachineName } from '../../productionSchedule/machineName';

import { dayLabel, dayToDate } from './planningBoardGanttLayout';
import { GANTT_HATCH, GANTT_LABEL_WIDTH, PlanningBoardGanttRow } from './PlanningBoardGanttRow';

import type { GanttLayout } from './planningBoardGanttLayout';
import type { PlanningBoardGanttRowProps } from './PlanningBoardGanttRow';
import type { GrindingPlanningBoardResourceDailyHours } from '@raspi-system/shared-types';

type Props = Pick<PlanningBoardGanttRowProps, 'disabled' | 'dragDisabled' | 'onToggleItem' | 'onDueDrop' | 'selectedItemIds' | 'resourceView'> & {
  layout: GanttLayout;
  scale: number;
  dailyHoursByResource: Readonly<Record<string, GrindingPlanningBoardResourceDailyHours>>;
  resourceNameMap: Record<string, string[]>;
  capacityPending: boolean;
  capacityError: boolean;
  onCapacityChange: (resourceCd: string, dailyHours: GrindingPlanningBoardResourceDailyHours) => void;
};
export type PlanningBoardGanttHandle = { scrollToNextOverlap: () => void };
const WEEKDAYS = ['日', '月', '火', '水', '木', '金', '土'];
const GANTT_BOTTOM_GAP = 10;
// With a 2- or 4-day span a day is wide enough to show where the hours fall.
const HOUR_TICKS = [6, 12, 18];
const HOUR_TICK_MIN_DAY_WIDTH = 160;

export const PlanningBoardGanttView = forwardRef<PlanningBoardGanttHandle, Props>(function PlanningBoardGanttView({
  layout, scale, dailyHoursByResource, resourceNameMap, capacityPending, capacityError, onCapacityChange, ...interaction
}, ref) {
  const viewport = useRef<HTMLDivElement>(null);
  const [viewportWidth, setViewportWidth] = useState(1120);
  const [viewportHeight, setViewportHeight] = useState<number | null>(null);
  const flaggedIndex = useRef(-1);
  const previousAxis = useRef<{ start: number; dayWidth: number; scale: number } | null>(null);
  const dayWidth = Math.max(1, viewportWidth - GANTT_LABEL_WIDTH) / scale;
  const width = (layout.end - layout.start) * dayWidth;
  const showHours = dayWidth >= HOUR_TICK_MIN_DAY_WIDTH;
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
    // A new scale starts near today so a 2- or 4-day span does not open on past days; data changes keep the position.
    const firstDay = previous && previous.scale === scale
      ? previous.start + viewport.current.scrollLeft / previous.dayWidth
      : layout.today - (scale < 7 ? 0 : 3);
    viewport.current.scrollLeft = Math.max(0, (firstDay - layout.start) * dayWidth);
    previousAxis.current = { start: layout.start, dayWidth, scale };
  }, [dayWidth, layout.start, layout.today, scale]);
  useImperativeHandle(ref, () => ({ scrollToNextOverlap: () => {
    const element = viewport.current;
    const rows = element?.querySelectorAll<HTMLElement>('[data-gantt-flagged="true"]');
    if (!element || !rows?.length) return;
    flaggedIndex.current = (flaggedIndex.current + 1) % rows.length;
    const row = rows[flaggedIndex.current]!;
    element.scrollTop += row.getBoundingClientRect().top - element.getBoundingClientRect().top - 56;
    const bar = row.querySelector<HTMLElement>('[data-testid^="planning-gantt-bar-"]');
    if (bar) element.scrollLeft = Math.max(0, parseFloat(bar.style.left) - (viewportWidth - GANTT_LABEL_WIDTH) / 2);
  } }), [viewportWidth]);
  const days = useMemo(() => Array.from({ length: layout.end - layout.start }, (_, i) => {
    const day = layout.start + i;
    const weekday = new Date(day * 86_400_000).getUTCDay();
    return { day, weekday, weekend: weekday === 0 || weekday === 6 };
  }), [layout.end, layout.start]);
  const selectedParts = useMemo(() => new Set(layout.groups.flatMap((group) => group.rows.flatMap((row) =>
    row.bars.filter((bar) => interaction.selectedItemIds.has(bar.item.itemId)).map((bar) => bar.partKey)
  ))), [interaction.selectedItemIds, layout]);
  return (
    <section aria-label="製番ボード ガント" data-testid="planning-board-gantt" className="mt-2 overflow-hidden rounded-lg border border-slate-800 bg-slate-900">
      {capacityError && <p role="alert" className="px-2 py-1 text-xs text-rose-200">稼働時間を保存できませんでした。</p>}
      <div ref={viewport} className="relative min-h-48 overflow-auto" style={viewportHeight ? { height: viewportHeight } : undefined} tabIndex={0} aria-label="ガントの日付と工程">
        <div className="relative isolate" style={{ width: GANTT_LABEL_WIDTH + width }}>
          <div className="sticky top-0 z-30 flex h-14 border-b border-slate-700 bg-slate-950">
            <div className="sticky left-0 z-40 flex shrink-0 flex-wrap items-center gap-x-3 bg-slate-950 px-2 text-[10px] text-slate-300" style={{ width: GANTT_LABEL_WIDTH }}>
              <span><i className="mr-1 inline-block h-2 w-4 rounded bg-sky-400" />予定</span>
              <span><i className="mr-1 inline-block h-2 w-4 rounded bg-rose-400" />納期超過</span>
              <span><i className="mr-1 inline-block h-2 w-4 rounded" style={{ background: GANTT_HATCH }} />工程の重なり</span>
              <span><i className="mr-1 inline-block h-2 w-4 rounded bg-slate-600" />完了</span>
            </div>
            {days.map(({ day, weekday, weekend }) => <div key={day} className={clsx('relative shrink-0 overflow-hidden border-l border-slate-800 py-2 text-center text-[10px] tabular-nums', day === layout.today ? 'bg-emerald-400 font-bold text-slate-950' : weekend ? 'bg-slate-800 text-slate-300' : 'text-slate-300')}
              style={{ width: dayWidth }} title={dayToDate(day)}>
              <span className="whitespace-nowrap">{dayWidth >= 26 || weekday === 1 ? dayLabel(day) : ''}</span><small className="block">{WEEKDAYS[weekday]}</small>
              {showHours && HOUR_TICKS.filter((hour) => hour !== 12).map((hour) => <span key={hour} className="absolute bottom-0.5 -translate-x-1/2 text-[9px] opacity-70" style={{ left: `${hour / 24 * 100}%` }}>{hour}時</span>)}
            </div>)}
          </div>
          {days.map(({ day, weekend }) => <div key={day} className={clsx('pointer-events-none absolute bottom-0 top-14 border-l border-slate-800/70', weekend && 'bg-slate-950/50')}
            style={{ left: GANTT_LABEL_WIDTH + (day - layout.start) * dayWidth, width: dayWidth }} />)}
          {showHours && days.flatMap(({ day }) => HOUR_TICKS.map((hour) => <div key={`${day}-${hour}`} className="pointer-events-none absolute bottom-0 top-14 border-l border-dashed border-slate-700/60"
            style={{ left: GANTT_LABEL_WIDTH + (day - layout.start + hour / 24) * dayWidth }} />))}
          <div className="pointer-events-none absolute bottom-0 top-14 z-[1] w-px bg-emerald-400" style={{ left: GANTT_LABEL_WIDTH + (layout.today - layout.start) * dayWidth }} />
          {layout.groups.map((group) => <div key={group.key}>
            <div className="relative flex min-h-11 border-b border-slate-700 bg-slate-800">
              <div className="sticky left-0 z-20 flex min-h-11 shrink-0 items-center gap-1 bg-slate-800 px-2 text-xs" style={{ width: GANTT_LABEL_WIDTH }}>
                <strong className="min-w-0 flex-1 truncate" title={group.label}>{normalizeMachineName(group.label)}{group.resource && resourceNameMap[group.resource]?.length ? ` ${resourceNameMap[group.resource]!.join('・')}` : ''}</strong>
                {group.resource && group.resource !== '未設定' && <div className="flex shrink-0 gap-1" role="group" aria-label={`${group.resource}の1日の稼働時間`}>
                  {GRINDING_PLANNING_BOARD_RESOURCE_DAILY_HOURS.map((hours) => <button key={hours} type="button"
                    className={clsx('min-h-11 min-w-11 rounded border px-1 font-mono text-[11px] font-bold',
                      (dailyHoursByResource[group.resource!] ?? GRINDING_PLANNING_BOARD_DEFAULT_RESOURCE_DAILY_HOURS) === hours ? 'border-sky-300 bg-sky-400 text-slate-950' : 'border-slate-600 bg-slate-900 text-slate-200')}
                    aria-pressed={(dailyHoursByResource[group.resource!] ?? GRINDING_PLANNING_BOARD_DEFAULT_RESOURCE_DAILY_HOURS) === hours}
                    disabled={capacityPending || interaction.disabled}
                    onClick={() => onCapacityChange(group.resource!, hours)}>{hours}H</button>)}
                </div>}
              </div>
            </div>
            {group.rows.map((row) => <PlanningBoardGanttRow key={row.key} row={row} start={layout.start} width={width} dayWidth={dayWidth}
              today={dayToDate(layout.today)} selectedParts={selectedParts} {...interaction} />)}
          </div>)}
        </div>
      </div>
    </section>
  );
});
