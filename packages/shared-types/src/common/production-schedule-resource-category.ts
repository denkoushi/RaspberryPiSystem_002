export const PRODUCTION_SCHEDULE_GRINDING_RESOURCE_CDS = [
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
] as const;

const grindingResourceCdSet = new Set<string>(PRODUCTION_SCHEDULE_GRINDING_RESOURCE_CDS);

export type ProductionScheduleResourceCategory = 'grinding' | 'cutting';

export const isProductionScheduleGrindingResourceCd = (resourceCd: string) => {
  return grindingResourceCdSet.has(resourceCd.trim());
};

export const filterProductionScheduleResourceCdsByCategory = (
  resourceCds: string[],
  category: ProductionScheduleResourceCategory | undefined
) => {
  if (!category) {
    return resourceCds;
  }

  if (category === 'grinding') {
    return resourceCds.filter((cd) => isProductionScheduleGrindingResourceCd(cd));
  }

  return resourceCds.filter((cd) => !isProductionScheduleGrindingResourceCd(cd));
};
