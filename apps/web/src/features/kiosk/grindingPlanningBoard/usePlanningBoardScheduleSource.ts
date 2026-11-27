import { GRINDING_PLANNING_BOARD_SCHEDULE_SOURCES, type GrindingPlanningBoardScheduleSource } from '@raspi-system/shared-types';
import { useCallback, useState } from 'react';


export const SCHEDULE_SOURCE_OPTIONS = [
  { value: 'general', label: '一般' },
  { value: 'dCompany', label: 'D社' },
  { value: 'both', label: '両方' }
] as const satisfies readonly { value: GrindingPlanningBoardScheduleSource; label: string }[];

export function isScheduleSource(value: unknown): value is GrindingPlanningBoardScheduleSource {
  return (GRINDING_PLANNING_BOARD_SCHEDULE_SOURCES as readonly unknown[]).includes(value);
}

export const SCHEDULE_SOURCE_STORAGE_KEY = 'kiosk-planning-board-schedule-source';

function loadScheduleSource(storageKey: string): GrindingPlanningBoardScheduleSource {
  try {
    const saved = JSON.parse(window.localStorage.getItem(storageKey) ?? 'null');
    if (saved?.schemaVersion === 1 && isScheduleSource(saved.scheduleSource)) return saved.scheduleSource;
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
