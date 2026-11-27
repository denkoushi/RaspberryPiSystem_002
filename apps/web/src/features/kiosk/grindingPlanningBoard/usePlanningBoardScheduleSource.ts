import { useCallback, useState } from 'react';

import type { GrindingPlanningBoardScheduleSource } from '@raspi-system/shared-types';

export const SCHEDULE_SOURCE_STORAGE_KEY = 'kiosk-planning-board-schedule-source';

function loadScheduleSource(storageKey: string): GrindingPlanningBoardScheduleSource {
  try {
    const saved = JSON.parse(window.localStorage.getItem(storageKey) ?? 'null');
    if (saved?.schemaVersion === 1 && ['general', 'dCompany', 'both'].includes(saved.scheduleSource)) return saved.scheduleSource;
  } catch {
    // A kiosk may prohibit local storage.
  }
  return 'both';
}

export function usePlanningBoardScheduleSource(storageKey = SCHEDULE_SOURCE_STORAGE_KEY) {
  const [scheduleSource, setScheduleSource] = useState(() => loadScheduleSource(storageKey));
  const changeScheduleSource = useCallback((scheduleSource: GrindingPlanningBoardScheduleSource) => {
    setScheduleSource(scheduleSource);
    try {
      window.localStorage.setItem(storageKey, JSON.stringify({ schemaVersion: 1, scheduleSource }));
    } catch {
      // Keep the selection for this session even when storage is unavailable.
    }
  }, [storageKey]);
  return { scheduleSource, changeScheduleSource };
}
