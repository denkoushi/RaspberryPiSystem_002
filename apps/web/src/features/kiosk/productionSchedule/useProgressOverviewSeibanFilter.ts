import { useCallback, useEffect, useMemo, useState } from 'react';

const PROGRESS_OVERVIEW_SEIBAN_FILTER_STORAGE_KEY = 'kiosk-progress-overview-seiban-filter';
const PROGRESS_OVERVIEW_SEIBAN_FILTER_SCHEMA_VERSION = 1;

type ProgressOverviewSeibanFilterPersistedValue = {
  schemaVersion: number;
  selectionBySeiban: Record<string, boolean>;
};

export type ProgressOverviewSeibanFilterCandidate = {
  fseiban: string;
  machineName: string | null;
};

export type ProgressOverviewSeibanFilterItem = ProgressOverviewSeibanFilterCandidate & {
  selected: boolean;
};

const normalizeCandidates = (
  candidates: ProgressOverviewSeibanFilterCandidate[]
): ProgressOverviewSeibanFilterCandidate[] => {
  const seen = new Set<string>();
  const normalized: ProgressOverviewSeibanFilterCandidate[] = [];
  candidates.forEach((candidate) => {
    const fseiban = candidate.fseiban.trim();
    if (fseiban.length === 0 || seen.has(fseiban)) {
      return;
    }
    seen.add(fseiban);
    const machineName = candidate.machineName?.trim() || null;
    normalized.push({ fseiban, machineName });
  });
  return normalized;
};

const loadSelection = (): Record<string, boolean> => {
  if (typeof window === 'undefined') {
    return {};
  }
  const raw = window.localStorage.getItem(PROGRESS_OVERVIEW_SEIBAN_FILTER_STORAGE_KEY);
  if (!raw) {
    return {};
  }
  try {
    const parsed = JSON.parse(raw) as Partial<ProgressOverviewSeibanFilterPersistedValue> | null;
    if (!parsed || parsed.schemaVersion !== PROGRESS_OVERVIEW_SEIBAN_FILTER_SCHEMA_VERSION) {
      return {};
    }
    const source = parsed.selectionBySeiban;
    if (!source || typeof source !== 'object') {
      return {};
    }
    return Object.entries(source).reduce<Record<string, boolean>>((acc, [key, value]) => {
      if (typeof value !== 'boolean') {
        return acc;
      }
      const trimmed = key.trim();
      if (trimmed.length === 0) {
        return acc;
      }
      acc[trimmed] = value;
      return acc;
    }, {});
  } catch {
    return {};
  }
};

export function useProgressOverviewSeibanFilter(candidatesInput: ProgressOverviewSeibanFilterCandidate[]) {
  const candidates = useMemo(() => normalizeCandidates(candidatesInput), [candidatesInput]);
  const candidateSeibans = useMemo(() => candidates.map((candidate) => candidate.fseiban), [candidates]);
  const [selectionBySeiban, setSelectionBySeiban] = useState<Record<string, boolean>>(loadSelection);

  useEffect(() => {
    setSelectionBySeiban((prev) => {
      if (candidateSeibans.length === 0) {
        return {};
      }
      let changed = false;
      const next: Record<string, boolean> = {};
      candidateSeibans.forEach((fseiban) => {
        if (Object.prototype.hasOwnProperty.call(prev, fseiban)) {
          next[fseiban] = prev[fseiban];
          return;
        }
        changed = true;
        next[fseiban] = true;
      });

      const prevKeys = Object.keys(prev);
      if (!changed && prevKeys.length !== candidateSeibans.length) {
        changed = true;
      }

      return changed ? next : prev;
    });
  }, [candidateSeibans]);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }
    const payload: ProgressOverviewSeibanFilterPersistedValue = {
      schemaVersion: PROGRESS_OVERVIEW_SEIBAN_FILTER_SCHEMA_VERSION,
      selectionBySeiban
    };
    window.localStorage.setItem(PROGRESS_OVERVIEW_SEIBAN_FILTER_STORAGE_KEY, JSON.stringify(payload));
  }, [selectionBySeiban]);

  const items = useMemo<ProgressOverviewSeibanFilterItem[]>(
    () =>
      candidates.map((candidate) => ({
        ...candidate,
        selected: selectionBySeiban[candidate.fseiban] ?? true
      })),
    [candidates, selectionBySeiban]
  );

  const selectedSet = useMemo(
    () => new Set(items.filter((item) => item.selected).map((item) => item.fseiban)),
    [items]
  );

  const toggle = useCallback((fseiban: string) => {
    setSelectionBySeiban((prev) => {
      const trimmed = fseiban.trim();
      if (trimmed.length === 0) {
        return prev;
      }
      const current = prev[trimmed] ?? true;
      return {
        ...prev,
        [trimmed]: !current
      };
    });
  }, []);

  const setAll = useCallback(
    (selected: boolean) => {
      setSelectionBySeiban((prev) => {
        if (candidateSeibans.length === 0) {
          return {};
        }
        let changed = false;
        const next = { ...prev };
        candidateSeibans.forEach((fseiban) => {
          if (next[fseiban] !== selected) {
            changed = true;
            next[fseiban] = selected;
          }
        });
        return changed ? next : prev;
      });
    },
    [candidateSeibans]
  );

  const selectedCount = selectedSet.size;
  const totalCount = items.length;

  return {
    items,
    selectedSet,
    selectedCount,
    totalCount,
    isAllOff: totalCount > 0 && selectedCount === 0,
    toggle,
    setAll
  } as const;
}
