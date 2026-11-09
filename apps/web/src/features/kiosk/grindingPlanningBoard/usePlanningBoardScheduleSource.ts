import { useCallback, useState } from 'react';

import type { GrindingPlanningBoardScheduleSource } from '@raspi-system/shared-types';

export const SCHEDULE_SOURCE_STORAGE_KEY = 'kiosk-planning-board-schedule-source';

function loadScheduleSource(): GrindingPlanningBoardScheduleSource {
  try {
    const saved = JSON.parse(window.localStorage.getItem(SCHEDULE_SOURCE_STORAGE_KEY) ?? 'null');
    if (saved?.schemaVersion === 1 && ['general', 'dCompany', 'both'].includes(saved.scheduleSource)) return saved.scheduleSource;
  } catch {
    // A kiosk may prohibit local storage.
  }
  return 'both';
}

export function usePlanningBoardScheduleSource() {
  const [scheduleSource, setScheduleSource] = useState(loadScheduleSource);
  const changeScheduleSource = useCallback((scheduleSource: GrindingPlanningBoardScheduleSource) => {
    setScheduleSource(scheduleSource);
    try {
      window.localStorage.setItem(SCHEDULE_SOURCE_STORAGE_KEY, JSON.stringify({ schemaVersion: 1, scheduleSource }));
    } catch {
      // Keep the selection for this session even when storage is unavailable.
    }
  }, []);
  return { scheduleSource, changeScheduleSource };
}
