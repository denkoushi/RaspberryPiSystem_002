export type DueManagementResourceCategory = 'grinding' | 'cutting';

export type DueManagementFiltersState = {
  selectedResourceCd: string;
  showGrindingResources: boolean;
  showCuttingResources: boolean;
};

export const DUE_MANAGEMENT_FILTERS_STORAGE_KEY = 'due-management-resource-filters';

export const DEFAULT_DUE_MANAGEMENT_FILTERS_STATE: DueManagementFiltersState = {
  selectedResourceCd: '',
  showGrindingResources: false,
  showCuttingResources: false
};

export const sanitizeDueManagementFiltersState = (value: unknown): DueManagementFiltersState => {
  const raw = value && typeof value === 'object' ? (value as Partial<DueManagementFiltersState>) : {};
  const selectedResourceCd =
    typeof raw.selectedResourceCd === 'string' ? raw.selectedResourceCd.trim() : '';
  const showGrindingResources = raw.showGrindingResources === true;
  const showCuttingResources = raw.showCuttingResources === true;
  if (showGrindingResources && showCuttingResources) {
    return {
      selectedResourceCd,
      showGrindingResources: false,
      showCuttingResources: false
    };
  }
  return {
    selectedResourceCd,
    showGrindingResources,
    showCuttingResources
  };
};

export const resolveDueManagementResourceCategory = (
  state: DueManagementFiltersState
): DueManagementResourceCategory | undefined => {
  if (state.showGrindingResources && !state.showCuttingResources) {
    return 'grinding';
  }
  if (state.showCuttingResources && !state.showGrindingResources) {
    return 'cutting';
  }
  return undefined;
};

export const toDueManagementFilterParams = (state: DueManagementFiltersState) => {
  const resourceCategory = resolveDueManagementResourceCategory(state);
  return {
    resourceCd: state.selectedResourceCd || undefined,
    resourceCategory
  };
};

export const toggleDueManagementGrindingFilter = (
  state: DueManagementFiltersState
): DueManagementFiltersState => {
  const nextGrinding = !state.showGrindingResources;
  return {
    ...state,
    showGrindingResources: nextGrinding,
    showCuttingResources: nextGrinding ? false : state.showCuttingResources
  };
};

export const toggleDueManagementCuttingFilter = (
  state: DueManagementFiltersState
): DueManagementFiltersState => {
  const nextCutting = !state.showCuttingResources;
  return {
    ...state,
    showCuttingResources: nextCutting,
    showGrindingResources: nextCutting ? false : state.showGrindingResources
  };
};
