import {
  filterProductionScheduleResourceCdsByCategory,
  isProductionScheduleGrindingResourceCd
} from '@raspi-system/shared-types';

export type ResourceCategoryFilter = {
  showGrinding: boolean;
  showCutting: boolean;
};

export const isGrindingResourceCd = (resourceCd: string) => {
  return isProductionScheduleGrindingResourceCd(resourceCd);
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
