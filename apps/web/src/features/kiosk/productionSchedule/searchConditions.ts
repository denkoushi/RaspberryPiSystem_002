export const SEARCH_CONDITIONS_STORAGE_KEY = 'production-schedule-search-conditions';
export const SEARCH_CONDITIONS_SCHEMA_VERSION = 1;

export type ProductionScheduleSearchConditions = {
  activeQueries: string[];
  activeResourceCds: string[];
  activeResourceAssignedOnlyCds: string[];
  hasNoteOnlyFilter: boolean;
  hasDueDateOnlyFilter: boolean;
  showGrindingResources: boolean;
  showCuttingResources: boolean;
  selectedMachineName: string;
  selectedPartName: string;
  inputQuery: string;
};

export type PersistedProductionScheduleSearchConditions = {
  schemaVersion: number;
  conditions: ProductionScheduleSearchConditions;
};

export const DEFAULT_SEARCH_CONDITIONS: ProductionScheduleSearchConditions = {
  activeQueries: [],
  activeResourceCds: [],
  activeResourceAssignedOnlyCds: [],
  hasNoteOnlyFilter: false,
  hasDueDateOnlyFilter: false,
  showGrindingResources: false,
  showCuttingResources: false,
  selectedMachineName: '',
  selectedPartName: '',
  inputQuery: ''
};
