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

export const DEFAULT_PRODUCTION_SCHEDULE_CUTTING_EXCLUDED_RESOURCE_CDS = ['10', 'MSZ'] as const;

const grindingResourceCdSet = new Set<string>(PRODUCTION_SCHEDULE_GRINDING_RESOURCE_CDS);

export type ProductionScheduleResourceCategory = 'grinding' | 'cutting';

export const isProductionScheduleGrindingResourceCd = (resourceCd: string) => {
  return grindingResourceCdSet.has(resourceCd.trim());
};

export const filterProductionScheduleResourceCdsByCategory = (
  resourceCds: string[],
  category: ProductionScheduleResourceCategory | undefined,
  options?: {
    cuttingExcludedResourceCds?: string[];
  }
) => {
  if (!category) {
    return resourceCds;
  }

  if (category === 'grinding') {
    return resourceCds.filter((cd) => isProductionScheduleGrindingResourceCd(cd));
  }

  const excluded = new Set(
    (options?.cuttingExcludedResourceCds ?? [...DEFAULT_PRODUCTION_SCHEDULE_CUTTING_EXCLUDED_RESOURCE_CDS])
      .map((value) => value.trim())
      .filter((value) => value.length > 0)
  );
  return resourceCds.filter((cd) => !isProductionScheduleGrindingResourceCd(cd) && !excluded.has(cd.trim()));
};
