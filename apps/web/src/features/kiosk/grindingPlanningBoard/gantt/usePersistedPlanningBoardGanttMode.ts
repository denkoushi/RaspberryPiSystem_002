import { useCallback, useState } from 'react';

export type PlanningBoardGanttMode = 'forward' | 'backward';
export const GANTT_MODE_STORAGE_KEY = 'kiosk-planning-board-gantt-mode';

function loadMode(): PlanningBoardGanttMode {
  try {
    const saved = JSON.parse(window.localStorage.getItem(GANTT_MODE_STORAGE_KEY) ?? 'null');
    if (saved?.schemaVersion === 1 && (saved.mode === 'forward' || saved.mode === 'backward')) return saved.mode;
  } catch {
    // A kiosk may prohibit local storage.
  }
  return 'forward';
}

export function usePersistedPlanningBoardGanttMode() {
  const [mode, setMode] = useState(loadMode);
  const changeMode = useCallback((mode: PlanningBoardGanttMode) => {
    setMode(mode);
    try {
      window.localStorage.setItem(GANTT_MODE_STORAGE_KEY, JSON.stringify({ schemaVersion: 1, mode }));
    } catch {
      // Keep the selection for this session even when storage is unavailable.
    }
  }, []);
  return { mode, changeMode };
}
