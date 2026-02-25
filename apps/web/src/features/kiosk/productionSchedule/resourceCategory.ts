export type ResourceCategoryFilter = {
  showGrinding: boolean;
  showCutting: boolean;
};

export const GRINDING_RESOURCE_CDS = new Set<string>([
  '305',
  '581',
  '582',
  '583',
  '584',
  '585',
  '586',
  '587',
  '588',
  '589'
]);

export const isGrindingResourceCd = (resourceCd: string) => {
  return GRINDING_RESOURCE_CDS.has(resourceCd.trim());
};

export const filterResourceCdsByCategory = (
  resourceCds: string[],
  filter: ResourceCategoryFilter
) => {
  const { showGrinding, showCutting } = filter;

  if ((showGrinding && showCutting) || (!showGrinding && !showCutting)) {
    return resourceCds;
  }

  if (showGrinding) {
    return resourceCds.filter((cd) => isGrindingResourceCd(cd));
  }

  return resourceCds.filter((cd) => !isGrindingResourceCd(cd));
};
