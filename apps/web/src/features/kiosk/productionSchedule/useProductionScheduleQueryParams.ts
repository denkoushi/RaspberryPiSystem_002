import { normalizeKioskProductionScheduleSearchHistory as normalizeHistoryList } from '@raspi-system/shared-types';
import { useMemo } from 'react';

import { toHalfWidthAscii } from './machineName';

type Params = {
  activeQueries: string[];
  activeResourceCds: string[];
  activeResourceAssignedOnlyCds: string[];
  hasNoteOnlyFilter: boolean;
  hasDueDateOnlyFilter: boolean;
  showGrindingResources: boolean;
  showCuttingResources: boolean;
  selectedMachineName: string;
  selectedOrderNumbers: string[];
  history: string[];
};

export { normalizeHistoryList };

const normalizeUniqueStrings = (items: string[]) => {
  const unique = new Set<string>();
  items
    .map((item) => item.trim())
    .filter((item) => item.length > 0)
    .forEach((item) => unique.add(item));
  return Array.from(unique);
};

export const useProductionScheduleQueryParams = ({
  activeQueries,
  activeResourceCds,
  activeResourceAssignedOnlyCds,
  hasNoteOnlyFilter,
  hasDueDateOnlyFilter,
  showGrindingResources,
  showCuttingResources,
  selectedMachineName,
  selectedOrderNumbers,
  history
}: Params) => {
  const normalizedActiveQueries = useMemo(() => normalizeUniqueStrings(activeQueries), [activeQueries]);
  const normalizedResourceCds = useMemo(() => normalizeUniqueStrings(activeResourceCds), [activeResourceCds]);
  const normalizedAssignedOnlyCds = useMemo(
    () => normalizeUniqueStrings(activeResourceAssignedOnlyCds),
    [activeResourceAssignedOnlyCds]
  );
  const normalizedHistory = useMemo(() => normalizeHistoryList(history), [history]);
  const normalizedSelectedOrderNumbers = useMemo(
    () => normalizeUniqueStrings(selectedOrderNumbers),
    [selectedOrderNumbers]
  );
  const selectedResourceCategory = useMemo<'grinding' | 'cutting' | undefined>(() => {
    if (showGrindingResources === showCuttingResources) return undefined;
    return showGrindingResources ? 'grinding' : 'cutting';
  }, [showCuttingResources, showGrindingResources]);

  const queryParams = useMemo(
    () => ({
      q: normalizedActiveQueries.length > 0 ? normalizedActiveQueries.join(',') : undefined,
      productNos:
        normalizedSelectedOrderNumbers.length > 0
          ? normalizedSelectedOrderNumbers.join(',')
          : undefined,
      resourceCds: normalizedResourceCds.length > 0 ? normalizedResourceCds.join(',') : undefined,
      resourceAssignedOnlyCds: normalizedAssignedOnlyCds.length > 0 ? normalizedAssignedOnlyCds.join(',') : undefined,
      resourceCategory: selectedResourceCategory,
      machineName:
        selectedMachineName.trim().length > 0
          ? toHalfWidthAscii(selectedMachineName.trim()).toUpperCase()
          : undefined,
      hasNoteOnly: hasNoteOnlyFilter || undefined,
      hasDueDateOnly: hasDueDateOnlyFilter || undefined,
      page: 1,
      pageSize: 400
    }),
    [
      hasDueDateOnlyFilter,
      hasNoteOnlyFilter,
      normalizedActiveQueries,
      normalizedAssignedOnlyCds,
      normalizedSelectedOrderNumbers,
      normalizedResourceCds,
      selectedMachineName,
      selectedResourceCategory
    ]
  );

  const hasProcessingCategorySelection = showGrindingResources || showCuttingResources;
  const hasAnyResourceSelection =
    normalizedResourceCds.length > 0 || normalizedAssignedOnlyCds.length > 0;
  const hasMachineScopedResourceQuery =
    selectedMachineName.trim().length > 0 &&
    hasProcessingCategorySelection &&
    hasAnyResourceSelection;

  const hasQuery =
    normalizedActiveQueries.length > 0 ||
    normalizedSelectedOrderNumbers.length > 0 ||
    normalizedAssignedOnlyCds.length > 0 ||
    hasNoteOnlyFilter ||
    hasDueDateOnlyFilter ||
    hasMachineScopedResourceQuery;

  /** 機種名なしでも API は resourceCds + resourceCategory で絞り込み可能（手動順番下ペイン用） */
  const hasResourceCategoryResourceSelection =
    hasProcessingCategorySelection && hasAnyResourceSelection;

  return {
    normalizedActiveQueries,
    normalizedResourceCds,
    normalizedAssignedOnlyCds,
    normalizedSelectedOrderNumbers,
    normalizedHistory,
    visibleHistory: normalizedHistory,
    selectedResourceCategory,
    queryParams,
    hasQuery,
    hasResourceCategoryResourceSelection
  };
};
