import { useCallback, useState } from 'react';

export const GANTT_SCALES = [1, 2, 4, 7, 14, 28, 56] as const;
export type PlanningBoardGanttScale = typeof GANTT_SCALES[number];

export const ganttScaleLabel = (days: PlanningBoardGanttScale): string => (days < 7 ? `${days}日` : `${days / 7}週`);
export const GANTT_SCALE_STORAGE_KEY = 'kiosk-planning-board-gantt-scale';

function loadScale(): PlanningBoardGanttScale {
  try {
    const saved = JSON.parse(window.localStorage.getItem(GANTT_SCALE_STORAGE_KEY) ?? 'null');
    if (saved?.schemaVersion === 1 && GANTT_SCALES.includes(saved.days)) return saved.days;
  } catch {
    // A kiosk may prohibit local storage.
  }
  return 14;
}

export function usePersistedPlanningBoardGanttScale() {
  const [scale, setScale] = useState(loadScale);
  const changeScale = useCallback((days: PlanningBoardGanttScale) => {
    setScale(days);
    try {
      window.localStorage.setItem(GANTT_SCALE_STORAGE_KEY, JSON.stringify({ schemaVersion: 1, days }));
    } catch {
      // Keep the selection for this session even when storage is unavailable.
    }
  }, []);
  return { scale, changeScale };
}
