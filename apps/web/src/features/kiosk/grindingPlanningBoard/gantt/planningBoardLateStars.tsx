import { useContext, useMemo } from 'react';

import { DScheduleMinutesContext } from '../../productionSchedule/DScheduleMinutesContext';

import { dateToDay, isNormalGanttBar } from './planningBoardGanttLayout';

import type { GanttBar, NormalGanttBar } from './planningBoardGanttLayout';

type SendOutDates = ReadonlyMap<string, { surfaceSendOutDates: readonly { date: string }[] }>;
export type SendOutRow = { bar: NormalGanttBar; sendOutDay: number };

function isSurfaceSendOutBar(bar: GanttBar): bar is NormalGanttBar {
  return isNormalGanttBar(bar) && bar.item.lslhSurface && !bar.item.afterLslhSurface && !bar.item.isCompleted && bar.tone !== 'completed';
}

export function planningBoardSendOutRows(bars: readonly GanttBar[], rows: SendOutDates): SendOutRow[] {
  const parts = new Map<string, SendOutRow>();
  for (const bar of bars) {
    if (!isSurfaceSendOutBar(bar)) continue;
    if (parts.has(bar.item.itemId)) continue;
    const dates = rows.get(bar.item.fseiban)?.surfaceSendOutDates;
    const sendOutDay = Math.min(...(dates ?? []).map(({ date }) => dateToDay(date)));
    if (Number.isFinite(sendOutDay)) parts.set(bar.item.itemId, { bar, sendOutDay });
  }
  return [...parts.values()].sort((a, b) => a.sendOutDay - b.sendOutDay ||
    (a.bar.start ?? Infinity) - (b.bar.start ?? Infinity));
}

export function usePlanningBoardLateStars(bars: readonly GanttBar[], today: number) {
  const { rows } = useContext(DScheduleMinutesContext);
  return useMemo(() => new Set(bars.filter((bar) => isSurfaceSendOutBar(bar) &&
    rows.get(bar.item.fseiban)?.surfaceSendOutDates.some(({ date }) => dateToDay(date) < today))
    .map((bar) => bar.item.itemId)), [bars, rows, today]);
}

export function PlanningBoardLateStar({ left, top }: { left: number; top: number }) {
  return <span data-testid="planning-gantt-late-star" className="pointer-events-none absolute z-[9] text-[16px] leading-none text-violet-300"
    style={{ left, top, textShadow: '0 1px 2px #020617, 1px 0 2px #020617' }}>★</span>;
}
