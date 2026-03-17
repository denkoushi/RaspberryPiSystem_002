import {
  filterProductionScheduleResourceCdsByCategory,
  isProductionScheduleGrindingResourceCd,
  type ProductionScheduleResourceCategory
} from '@raspi-system/shared-types';

export type ResourceCategoryFilter = {
  showGrinding: boolean;
  showCutting: boolean;
};

export type DueManagementResourceFilterParams = {
  resourceCd?: string;
  resourceCategory?: ProductionScheduleResourceCategory;
};

export const isGrindingResourceCd = (resourceCd: string) => {
  return isProductionScheduleGrindingResourceCd(resourceCd);
};

export const isCuttingResourceCd = (
  resourceCd: string,
  excludedResourceCdSet: Set<string>
) => {
  const normalized = resourceCd.trim();
  return !isGrindingResourceCd(normalized) && !excludedResourceCdSet.has(normalized);
};

export const filterResourceCdsByCategory = (
  resourceCds: string[],
  filter: ResourceCategoryFilter,
  options?: {
    cuttingExcludedResourceCds?: string[];
  }
) => {
  const { showGrinding, showCutting } = filter;

  if ((showGrinding && showCutting) || (!showGrinding && !showCutting)) {
    return resourceCds;
  }

  if (showGrinding) {
    return filterProductionScheduleResourceCdsByCategory(resourceCds, 'grinding');
  }

  return filterProductionScheduleResourceCdsByCategory(resourceCds, 'cutting', {
    cuttingExcludedResourceCds: options?.cuttingExcludedResourceCds
  });
};

export const getGrindingAndCuttingResourceCds = (
  resourceCds: string[],
  options?: {
    cuttingExcludedResourceCds?: string[];
  }
) => {
  const grinding = filterProductionScheduleResourceCdsByCategory(resourceCds, 'grinding');
  const cutting = filterProductionScheduleResourceCdsByCategory(resourceCds, 'cutting', {
    cuttingExcludedResourceCds: options?.cuttingExcludedResourceCds
  });
  const unique = new Set<string>();
  [...grinding, ...cutting].forEach((resourceCd) => {
    const normalized = resourceCd.trim();
    if (normalized.length > 0) {
      unique.add(normalized);
    }
  });
  return Array.from(unique);
};

export const partMatchesResourceFilter = (
  part: { processes: Array<{ resourceCd: string }> },
  filter: DueManagementResourceFilterParams,
  options?: {
    cuttingExcludedResourceCds?: string[];
  }
) => {
  const selectedResourceCd = filter.resourceCd?.trim() ?? '';
  if (selectedResourceCd.length > 0) {
    return part.processes.some((process) => process.resourceCd.trim() === selectedResourceCd);
  }

  const resourceCategory = filter.resourceCategory;
  if (!resourceCategory) {
    return true;
  }

  if (resourceCategory === 'grinding') {
    return part.processes.some((process) => isGrindingResourceCd(process.resourceCd));
  }

  const excludedResourceCdSet = new Set(
    (options?.cuttingExcludedResourceCds ?? []).map((value) => value.trim()).filter((value) => value.length > 0)
  );
  return part.processes.some((process) => isCuttingResourceCd(process.resourceCd, excludedResourceCdSet));
};
