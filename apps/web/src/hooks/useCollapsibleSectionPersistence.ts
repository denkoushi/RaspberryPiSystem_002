import { useState } from 'react';

export type DueManagementSectionOpenState = {
  triage: boolean;
  globalRank: boolean;
  dailyPlan: boolean;
};

const parseStoredState = (
  storageKey: string,
  defaultState: DueManagementSectionOpenState
): DueManagementSectionOpenState => {
  if (typeof window === 'undefined') return defaultState;
  const raw = window.localStorage.getItem(storageKey);
  if (!raw) return defaultState;
  try {
    const parsed = JSON.parse(raw) as Partial<DueManagementSectionOpenState>;
    if (
      typeof parsed.triage !== 'boolean' ||
      typeof parsed.globalRank !== 'boolean' ||
      typeof parsed.dailyPlan !== 'boolean'
    ) {
      return defaultState;
    }
    return {
      triage: parsed.triage,
      globalRank: parsed.globalRank,
      dailyPlan: parsed.dailyPlan
    };
  } catch {
    return defaultState;
  }
};

export function useCollapsibleSectionPersistence(
  storageKey: string,
  defaultState: DueManagementSectionOpenState
) {
  const [state, setState] = useState<DueManagementSectionOpenState>(() => parseStoredState(storageKey, defaultState));

  const setPersistedState = (
    updater: (prev: DueManagementSectionOpenState) => DueManagementSectionOpenState
  ) => {
    setState((prev) => {
      const next = updater(prev);
      if (typeof window !== 'undefined') {
        window.localStorage.setItem(storageKey, JSON.stringify(next));
      }
      return next;
    });
  };

  return [state, setPersistedState] as const;
}
