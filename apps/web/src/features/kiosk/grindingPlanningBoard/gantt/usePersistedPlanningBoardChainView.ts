import { useCallback, useState } from 'react';

export type PlanningBoardChainView = 'pieces' | 'process';
export const CHAIN_VIEW_STORAGE_KEY = 'kiosk-planning-board-chain-view';

function loadView(): PlanningBoardChainView {
  try {
    const saved = JSON.parse(window.localStorage.getItem(CHAIN_VIEW_STORAGE_KEY) ?? 'null');
    if (saved?.schemaVersion === 1 && (saved.view === 'pieces' || saved.view === 'process')) return saved.view;
  } catch {
    // A kiosk may prohibit local storage.
  }
  return 'pieces';
}

export function usePersistedPlanningBoardChainView() {
  const [view, setView] = useState(loadView);
  const changeView = useCallback((view: PlanningBoardChainView) => {
    setView(view);
    try {
      window.localStorage.setItem(CHAIN_VIEW_STORAGE_KEY, JSON.stringify({ schemaVersion: 1, view }));
    } catch {
      // Keep the selection for this session even when storage is unavailable.
    }
  }, []);
  return { view, changeView };
}
