import {
  DEFAULT_SEARCH_CONDITIONS,
  SEARCH_CONDITIONS_SCHEMA_VERSION,
  SEARCH_CONDITIONS_STORAGE_KEY,
  type PersistedProductionScheduleSearchConditions
} from '../kiosk/productionSchedule/searchConditions';

import type { PartMeasurementProcessGroup } from './types';

const STORAGE_KEY = 'part-measurement-process-group';
const INIT_FLAG_KEY = 'part-measurement-process-group-init-from-schedule';
const SCHEMA_VERSION = 1;

type Persisted = {
  schemaVersion: number;
  processGroup: PartMeasurementProcessGroup;
};

const defaultGroup = (): PartMeasurementProcessGroup => 'cutting';

function readScheduleProcessGroup(): PartMeasurementProcessGroup | null {
  if (typeof window === 'undefined') return null;
  const raw = window.localStorage.getItem(SEARCH_CONDITIONS_STORAGE_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<PersistedProductionScheduleSearchConditions> | null;
    if (!parsed || parsed.schemaVersion !== SEARCH_CONDITIONS_SCHEMA_VERSION) return null;
    const c = parsed.conditions ?? DEFAULT_SEARCH_CONDITIONS;
    if (c.showGrindingResources && !c.showCuttingResources) return 'grinding';
    if (c.showCuttingResources && !c.showGrindingResources) return 'cutting';
    return null;
  } catch {
    return null;
  }
}

export function loadPartMeasurementProcessGroup(): PartMeasurementProcessGroup {
  if (typeof window === 'undefined') return defaultGroup();

  if (!window.localStorage.getItem(INIT_FLAG_KEY)) {
    const copied = readScheduleProcessGroup();
    if (copied) {
      const payload: Persisted = { schemaVersion: SCHEMA_VERSION, processGroup: copied };
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
    }
    window.localStorage.setItem(INIT_FLAG_KEY, '1');
  }

  const stored = window.localStorage.getItem(STORAGE_KEY);
  if (!stored) return defaultGroup();
  try {
    const parsed = JSON.parse(stored) as Partial<Persisted>;
    if (parsed.schemaVersion !== SCHEMA_VERSION) return defaultGroup();
    if (parsed.processGroup === 'grinding' || parsed.processGroup === 'cutting') {
      return parsed.processGroup;
    }
    return defaultGroup();
  } catch {
    return defaultGroup();
  }
}

export function savePartMeasurementProcessGroup(processGroup: PartMeasurementProcessGroup): void {
  if (typeof window === 'undefined') return;
  const payload: Persisted = { schemaVersion: SCHEMA_VERSION, processGroup };
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
}
