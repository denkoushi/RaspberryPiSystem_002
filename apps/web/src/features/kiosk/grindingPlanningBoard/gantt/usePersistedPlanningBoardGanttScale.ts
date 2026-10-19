import { useCallback, useState } from 'react';

export const GANTT_SCALES = [1, 2, 4, 7, 14, 28, 56] as const;
export type PlanningBoardGanttScale = typeof GANTT_SCALES[number];

export const ganttScaleLabel = (days: PlanningBoardGanttScale): string => (days < 7 ? `${days}日` : `${days / 7}週`);

/** The board always opens on one day; each scale press, even of the current scale, asks the chart to return to today. */
export function usePlanningBoardGanttScale() {
  const [state, setState] = useState<{ scale: PlanningBoardGanttScale; homeKey: number }>({ scale: 1, homeKey: 0 });
  const changeScale = useCallback((scale: PlanningBoardGanttScale) => {
    setState((current) => ({ scale, homeKey: current.homeKey + 1 }));
  }, []);
  return { scale: state.scale, homeKey: state.homeKey, changeScale };
}
