import { useContext } from 'react';

import { DScheduleMinutesContext } from '../../productionSchedule/DScheduleMinutesContext';

import { dateToDay } from './planningBoardGanttLayout';

import type { GanttBar } from './planningBoardGanttLayout';

/** 行に載る製番の処理出し日（★）を、その日の欄に1つずつ描く。 */
export function PlanningBoardGanttSendOutStars({ bars, start, dayWidth }: { bars: readonly GanttBar[]; start: number; dayWidth: number }) {
  const { rows } = useContext(DScheduleMinutesContext);
  const days = new Set<number>();
  for (const fseiban of new Set(bars.map((bar) => bar.item.fseiban))) {
    for (const { date } of rows.get(fseiban)?.surfaceSendOutDates ?? []) days.add(dateToDay(date));
  }
  return <>{[...days].map((day) => <span key={day} data-testid="planning-gantt-send-out-star"
    className="pointer-events-none absolute inset-y-0 z-[1] grid place-items-center text-[14px] text-violet-300"
    style={{ left: (day - start) * dayWidth, width: Math.max(dayWidth, 14) }}>★</span>)}</>;
}
