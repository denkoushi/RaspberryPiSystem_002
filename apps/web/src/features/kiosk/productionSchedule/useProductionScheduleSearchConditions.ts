import { useCallback, useEffect, useMemo, useState } from 'react';

import {
  DEFAULT_SEARCH_CONDITIONS,
  SEARCH_CONDITIONS_SCHEMA_VERSION,
  SEARCH_CONDITIONS_STORAGE_KEY,
  type PersistedProductionScheduleSearchConditions,
  type ProductionScheduleSearchConditions
} from './searchConditions';

const SAVE_DEBOUNCE_MS = 300;

type SearchConditionsPatch =
  | Partial<ProductionScheduleSearchConditions>
  | ((prev: ProductionScheduleSearchConditions) => Partial<ProductionScheduleSearchConditions>);

const sanitizeStringArray = (value: unknown): string[] => {
  if (!Array.isArray(value)) return [];
  const unique = new Set<string>();
  value.forEach((item) => {
    if (typeof item !== 'string') return;
    const trimmed = item.trim();
    if (trimmed.length === 0) return;
    unique.add(trimmed);
  });
  return Array.from(unique);
};

const sanitizeBoolean = (value: unknown, fallback: boolean) => (typeof value === 'boolean' ? value : fallback);

const sanitizeString = (value: unknown, fallback: string) => (typeof value === 'string' ? value : fallback);

const sanitizeConditions = (value: unknown): ProductionScheduleSearchConditions => {
  const raw = value && typeof value === 'object' ? (value as Partial<ProductionScheduleSearchConditions>) : {};
  return {
    activeQueries: sanitizeStringArray(raw.activeQueries),
    activeResourceCds: sanitizeStringArray(raw.activeResourceCds),
    activeResourceAssignedOnlyCds: sanitizeStringArray(raw.activeResourceAssignedOnlyCds),
    hasNoteOnlyFilter: sanitizeBoolean(raw.hasNoteOnlyFilter, DEFAULT_SEARCH_CONDITIONS.hasNoteOnlyFilter),
    hasDueDateOnlyFilter: sanitizeBoolean(raw.hasDueDateOnlyFilter, DEFAULT_SEARCH_CONDITIONS.hasDueDateOnlyFilter),
    showGrindingResources: sanitizeBoolean(raw.showGrindingResources, DEFAULT_SEARCH_CONDITIONS.showGrindingResources),
    showCuttingResources: sanitizeBoolean(raw.showCuttingResources, DEFAULT_SEARCH_CONDITIONS.showCuttingResources),
    selectedMachineName: sanitizeString(raw.selectedMachineName, DEFAULT_SEARCH_CONDITIONS.selectedMachineName),
    selectedPartName: sanitizeString(raw.selectedPartName, DEFAULT_SEARCH_CONDITIONS.selectedPartName),
    inputQuery: sanitizeString(raw.inputQuery, DEFAULT_SEARCH_CONDITIONS.inputQuery)
  };
};

const loadConditions = (): ProductionScheduleSearchConditions => {
  if (typeof window === 'undefined') {
    return DEFAULT_SEARCH_CONDITIONS;
  }
  const stored = window.localStorage.getItem(SEARCH_CONDITIONS_STORAGE_KEY);
  if (!stored) return DEFAULT_SEARCH_CONDITIONS;

  try {
    const parsed = JSON.parse(stored) as Partial<PersistedProductionScheduleSearchConditions> | null;
    if (!parsed || parsed.schemaVersion !== SEARCH_CONDITIONS_SCHEMA_VERSION) {
      return DEFAULT_SEARCH_CONDITIONS;
    }
    return sanitizeConditions(parsed.conditions);
  } catch {
    return DEFAULT_SEARCH_CONDITIONS;
  }
};

export function useProductionScheduleSearchConditions() {
  const [conditions, setConditionsState] = useState<ProductionScheduleSearchConditions>(loadConditions);

  const setConditions = useCallback((patch: SearchConditionsPatch) => {
    setConditionsState((prev) => {
      const nextPatch = typeof patch === 'function' ? patch(prev) : patch;
      return { ...prev, ...nextPatch };
    });
  }, []);

  const reset = useCallback(() => {
    setConditionsState(DEFAULT_SEARCH_CONDITIONS);
  }, []);

  const persistedValue = useMemo<PersistedProductionScheduleSearchConditions>(
    () => ({
      schemaVersion: SEARCH_CONDITIONS_SCHEMA_VERSION,
      conditions
    }),
    [conditions]
  );

  useEffect(() => {
    if (typeof window === 'undefined') return undefined;

    const timer = window.setTimeout(() => {
      window.localStorage.setItem(SEARCH_CONDITIONS_STORAGE_KEY, JSON.stringify(persistedValue));
    }, SAVE_DEBOUNCE_MS);

    return () => {
      window.clearTimeout(timer);
    };
  }, [persistedValue]);

  return [conditions, setConditions, reset] as const;
}
