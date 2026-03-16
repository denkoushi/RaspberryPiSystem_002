import type { ProductionScheduleResourceCategory } from '@raspi-system/shared-types';

import {
  DEFAULT_LOCATION_SCOPE_KEY,
  resolveSiteKeyFromScopeKey,
  type DeviceScopeKey,
  type SiteKey
} from '../../../lib/location-scope-resolver.js';
import { logger } from '../../../lib/logger.js';
import { prisma } from '../../../lib/prisma.js';
import { PRODUCTION_SCHEDULE_DASHBOARD_ID } from '../constants.js';

export const DEFAULT_CUTTING_EXCLUDED_RESOURCE_CDS = ['10', 'MSZ'] as const;
export const STATIC_GRINDING_RESOURCE_CDS = ['305', '581', '582', '583', '584', '585', '586', '587', '588', '589'] as const;

export const normalizeProductionScheduleResourceCd = (value: string): string => value.trim().toUpperCase();

export const normalizeProductionScheduleResourceCdList = (values: string[]): string[] => {
  const unique = new Set<string>();
  for (const raw of values) {
    const normalized = normalizeProductionScheduleResourceCd(raw);
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
  // Site-shared setting should be preferred when available.
  siteKey?: SiteKey | string;
  // Device scope is accepted only as a fallback input to derive siteKey.
  deviceScopeKey?: DeviceScopeKey | string;
};

export type ResourceCategorySiteResolution = {
  siteKey: string;
  source: 'siteKey' | 'deviceScopeKey' | 'default';
};

const normalizeScopeToken = (value: string | null | undefined): string => value?.trim() ?? '';

export const resolveResourceCategorySiteKey = (
  scope: ResourceCategoryPolicyScope
): string => {
  return resolveResourceCategorySiteResolution(scope).siteKey;
};

export const resolveResourceCategorySiteResolution = (
  scope: ResourceCategoryPolicyScope
): ResourceCategorySiteResolution => {
  const explicitSiteKey = normalizeScopeToken(scope.siteKey);
  if (explicitSiteKey) {
    return {
      siteKey: explicitSiteKey,
      source: 'siteKey'
    };
  }
  const deviceScopeKey = normalizeScopeToken(scope.deviceScopeKey);
  if (deviceScopeKey) {
    return {
      siteKey: resolveSiteKeyFromScopeKey(deviceScopeKey),
      source: 'deviceScopeKey'
    };
  }
  return {
    siteKey: DEFAULT_LOCATION_SCOPE_KEY,
    source: 'default'
  };
};

export async function getResourceCategoryPolicy(scope: ResourceCategoryPolicyScope): Promise<ResourceCategoryPolicy> {
  const siteResolution = resolveResourceCategorySiteResolution(scope);
  const siteKey = siteResolution.siteKey;
  if (siteResolution.source === 'default') {
    logger.warn(
      {
        siteKey,
        source: siteResolution.source
      },
      'Resource category policy resolved via default fallback'
    );
  }
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
    cuttingExcludedResourceCds: normalizeProductionScheduleResourceCdList(
      config?.cuttingExcludedResourceCds && config.cuttingExcludedResourceCds.length > 0
        ? config.cuttingExcludedResourceCds
        : [...DEFAULT_CUTTING_EXCLUDED_RESOURCE_CDS]
    )
  };
}

export function isProductionScheduleGrindingResourceCd(resourceCd: string, policy: ResourceCategoryPolicy): boolean {
  const normalized = normalizeProductionScheduleResourceCd(resourceCd);
  return policy.grindingResourceCds.includes(normalized);
}

export function isProductionScheduleExcludedCuttingResourceCd(resourceCd: string, policy: ResourceCategoryPolicy): boolean {
  const normalized = normalizeProductionScheduleResourceCd(resourceCd);
  if (normalized.length === 0) return false;
  return policy.cuttingExcludedResourceCds.includes(normalized);
}

export function isProductionScheduleCuttingResourceCd(resourceCd: string, policy: ResourceCategoryPolicy): boolean {
  const normalized = normalizeProductionScheduleResourceCd(resourceCd);
  if (normalized.length === 0) return false;
  if (isProductionScheduleGrindingResourceCd(normalized, policy)) return false;
  return !isProductionScheduleExcludedCuttingResourceCd(normalized, policy);
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
