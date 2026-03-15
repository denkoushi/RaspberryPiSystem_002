import type { ProductionScheduleResourceCategory } from '@raspi-system/shared-types';

import { DEFAULT_LOCATION_SCOPE_KEY, resolveSiteKeyFromScopeKey } from '../../../lib/location-scope-resolver.js';
import { prisma } from '../../../lib/prisma.js';
import { PRODUCTION_SCHEDULE_DASHBOARD_ID } from '../constants.js';

export const DEFAULT_CUTTING_EXCLUDED_RESOURCE_CDS = ['10', 'MSZ'] as const;
export const STATIC_GRINDING_RESOURCE_CDS = ['305', '581', '582', '583', '584', '585', '586', '587', '588', '589'] as const;

const normalizeResourceCd = (value: string): string => value.trim();

const normalizeResourceCdList = (values: string[]): string[] => {
  const unique = new Set<string>();
  for (const raw of values) {
    const normalized = normalizeResourceCd(raw);
    if (normalized.length === 0) continue;
    unique.add(normalized);
  }
  return Array.from(unique).sort((a, b) => a.localeCompare(b));
};

export type ResourceCategoryPolicy = {
  grindingResourceCds: string[];
  cuttingExcludedResourceCds: string[];
};

export type ResourceCategoryPolicyScope = {
  siteKey?: string;
  deviceScopeKey?: string;
  legacyLocationKey?: string;
};

const normalizeScopeToken = (value: string | null | undefined): string => value?.trim() ?? '';

export const resolveResourceCategorySiteKey = (
  scope: string | ResourceCategoryPolicyScope
): string => {
  if (typeof scope === 'string') {
    const normalized = normalizeScopeToken(scope);
    if (!normalized) return DEFAULT_LOCATION_SCOPE_KEY;
    return resolveSiteKeyFromScopeKey(normalized);
  }
  const explicitSiteKey = normalizeScopeToken(scope.siteKey);
  if (explicitSiteKey) return explicitSiteKey;
  const deviceScopeKey = normalizeScopeToken(scope.deviceScopeKey);
  if (deviceScopeKey) return resolveSiteKeyFromScopeKey(deviceScopeKey);
  const legacyLocationKey = normalizeScopeToken(scope.legacyLocationKey);
  if (legacyLocationKey) return resolveSiteKeyFromScopeKey(legacyLocationKey);
  return DEFAULT_LOCATION_SCOPE_KEY;
};

export async function getResourceCategoryPolicy(scope: string | ResourceCategoryPolicyScope): Promise<ResourceCategoryPolicy> {
  const siteKey = resolveResourceCategorySiteKey(scope);
  const config = await prisma.productionScheduleResourceCategoryConfig.findUnique({
    where: {
      csvDashboardId_location: {
        csvDashboardId: PRODUCTION_SCHEDULE_DASHBOARD_ID,
        location: siteKey
      }
    },
    select: {
      cuttingExcludedResourceCds: true
    }
  });

  return {
    grindingResourceCds: [...STATIC_GRINDING_RESOURCE_CDS],
    cuttingExcludedResourceCds: normalizeResourceCdList(
      config?.cuttingExcludedResourceCds && config.cuttingExcludedResourceCds.length > 0
        ? config.cuttingExcludedResourceCds
        : [...DEFAULT_CUTTING_EXCLUDED_RESOURCE_CDS]
    )
  };
}

export function isProductionScheduleGrindingResourceCd(resourceCd: string, policy: ResourceCategoryPolicy): boolean {
  const normalized = normalizeResourceCd(resourceCd);
  return policy.grindingResourceCds.includes(normalized);
}

export function isProductionScheduleCuttingResourceCd(resourceCd: string, policy: ResourceCategoryPolicy): boolean {
  const normalized = normalizeResourceCd(resourceCd);
  if (normalized.length === 0) return false;
  if (isProductionScheduleGrindingResourceCd(normalized, policy)) return false;
  return !policy.cuttingExcludedResourceCds.includes(normalized);
}

export function filterProductionScheduleResourceCdsByCategoryWithPolicy(
  resourceCds: string[],
  category: ProductionScheduleResourceCategory | undefined,
  policy: ResourceCategoryPolicy
): string[] {
  if (!category) {
    return resourceCds;
  }

  if (category === 'grinding') {
    return resourceCds.filter((cd) => isProductionScheduleGrindingResourceCd(cd, policy));
  }

  return resourceCds.filter((cd) => isProductionScheduleCuttingResourceCd(cd, policy));
}
