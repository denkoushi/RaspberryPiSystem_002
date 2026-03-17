import { useMemo } from 'react';

type Params = {
  activeQueries: string[];
  activeResourceCds: string[];
  activeResourceAssignedOnlyCds: string[];
  hasNoteOnlyFilter: boolean;
  hasDueDateOnlyFilter: boolean;
  showGrindingResources: boolean;
  showCuttingResources: boolean;
  selectedMachineName: string;
  history: string[];
};

export const normalizeHistoryList = (items: string[]) => {
  const unique = new Set<string>();
  const next: string[] = [];
  items
    .map((item) => item.trim())
    .filter((item) => item.length > 0)
    .forEach((item) => {
      if (unique.has(item)) return;
      unique.add(item);
      next.push(item);
    });
  return next.slice(0, 20);
};

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
  history
}: Params) => {
  const normalizedActiveQueries = useMemo(() => normalizeUniqueStrings(activeQueries), [activeQueries]);
  const normalizedResourceCds = useMemo(() => normalizeUniqueStrings(activeResourceCds), [activeResourceCds]);
  const normalizedAssignedOnlyCds = useMemo(
    () => normalizeUniqueStrings(activeResourceAssignedOnlyCds),
    [activeResourceAssignedOnlyCds]
  );
  const normalizedHistory = useMemo(() => normalizeHistoryList(history), [history]);
  const selectedResourceCategory = useMemo<'grinding' | 'cutting' | undefined>(() => {
    if (showGrindingResources === showCuttingResources) return undefined;
    return showGrindingResources ? 'grinding' : 'cutting';
  }, [showCuttingResources, showGrindingResources]);

  const queryParams = useMemo(
    () => ({
      q: normalizedActiveQueries.length > 0 ? normalizedActiveQueries.join(',') : undefined,
      resourceCds: normalizedResourceCds.length > 0 ? normalizedResourceCds.join(',') : undefined,
      resourceAssignedOnlyCds: normalizedAssignedOnlyCds.length > 0 ? normalizedAssignedOnlyCds.join(',') : undefined,
      resourceCategory: selectedResourceCategory,
      machineName: selectedMachineName.trim().length > 0 ? selectedMachineName.trim() : undefined,
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
    normalizedAssignedOnlyCds.length > 0 ||
    hasNoteOnlyFilter ||
    hasDueDateOnlyFilter ||
    hasMachineScopedResourceQuery;

  return {
    normalizedActiveQueries,
    normalizedResourceCds,
    normalizedAssignedOnlyCds,
    normalizedHistory,
    visibleHistory: normalizedHistory,
    selectedResourceCategory,
    queryParams,
    hasQuery
  };
};
