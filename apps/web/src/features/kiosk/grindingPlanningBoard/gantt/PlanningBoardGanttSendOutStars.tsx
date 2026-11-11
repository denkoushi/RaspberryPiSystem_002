import { useContext } from 'react';

import { DScheduleMinutesContext } from '../../productionSchedule/DScheduleMinutesContext';

import { isNormalGanttBar, dateToDay } from './planningBoardGanttLayout';

import type { GanttBar } from './planningBoardGanttLayout';
import type { GanttWindow } from './usePlanningBoardGanttWindow';

/** 行に載る製番の処理出し日（★）を、その日の欄に1つずつ描く。 */
export function PlanningBoardGanttSendOutStars({ bars, start, dayWidth, window = null }: { bars: readonly GanttBar[]; start: number; dayWidth: number; window?: GanttWindow }) {
  const { rows } = useContext(DScheduleMinutesContext);
  const days = new Set<number>();
  for (const fseiban of new Set(bars.filter(isNormalGanttBar).filter((bar) => bar.item.lslhSurface).map((bar) => bar.item.fseiban))) {
    for (const { date } of rows.get(fseiban)?.surfaceSendOutDates ?? []) days.add(dateToDay(date));
  }
  return <>{[...days].filter((day) => !window || (day - start) * dayWidth <= window.right && (day - start) * dayWidth + Math.max(dayWidth, 14) >= window.left).map((day) => <span key={day} data-testid="planning-gantt-send-out-star"
    className="pointer-events-none absolute inset-y-0 z-[1] grid place-items-center text-[14px] text-violet-300"
    style={{ left: (day - start) * dayWidth, width: Math.max(dayWidth, 14) }}>★</span>)}</>;
}
