import { useContext, useMemo } from 'react';

import { DScheduleMinutesContext } from '../../productionSchedule/DScheduleMinutesContext';

import { dateToDay } from './planningBoardGanttLayout';

import type { GanttBar } from './planningBoardGanttLayout';

export function usePlanningBoardLateStars(bars: readonly GanttBar[], today: number) {
  const { rows } = useContext(DScheduleMinutesContext);
  return useMemo(() => {
    const itemIds = new Set<string>();
    const dates = new Set<string>();
    for (const bar of bars) {
      if (!bar.item.lslhSurface || bar.item.isCompleted || bar.tone === 'completed') continue;
      for (const { date } of rows.get(bar.item.fseiban)?.surfaceSendOutDates ?? []) {
        if (dateToDay(date) >= today) continue;
        itemIds.add(bar.item.itemId);
        dates.add(date);
      }
    }
    return { itemIds, dates: [...dates].sort() };
  }, [bars, rows, today]);
}

export function PlanningBoardLateStarDates({ dates }: { dates: readonly string[] }) {
  return dates.length > 0 && <span data-testid="planning-gantt-late-star-dates" className="flex flex-wrap gap-1">
    {dates.map((date) => <span key={date} className="rounded bg-violet-500/25 px-1 font-mono text-[10px] text-violet-300">
      ★{Number(date.slice(5, 7))}/{Number(date.slice(8, 10))}
    </span>)}
  </span>;
}

export function PlanningBoardLateStar({ left, top }: { left: number; top: number }) {
  return <span data-testid="planning-gantt-late-star" className="pointer-events-none absolute z-[9] text-[16px] leading-none text-violet-300"
    style={{ left, top, textShadow: '0 1px 2px #020617, 1px 0 2px #020617' }}>★</span>;
}
