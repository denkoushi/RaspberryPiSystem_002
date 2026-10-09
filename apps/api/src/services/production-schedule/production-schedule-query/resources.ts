import { prisma } from '../../../lib/prisma.js';
import {
  PRODUCTION_SCHEDULE_DASHBOARD_ID,
} from '../constants.js';
import { buildMaxProductNoWinnerCondition } from '../row-resolver/index.js';
import {
  getResourceNameMapByResourceCds,
  type ProductionScheduleResourceNameMap
} from '../resource-master.service.js';
import {
  getResourceCategoryPolicy,
  isProductionScheduleExcludedCuttingResourceCd,
} from '../policies/resource-category-policy.service.js';

export type ProductionScheduleResourceListResult = {
  resources: string[];
  resourceItems: Array<{
    resourceCd: string;
    excluded: boolean;
  }>;
  resourceNameMap: ProductionScheduleResourceNameMap;
};

const RESOURCE_CDS_CACHE_TTL_MS = 5 * 60 * 1000;
let resourceCdsCache: { expiresAt: number; value: Promise<string[]> } | undefined;

export function resetProductionScheduleResourceCdsCache(): void {
  resourceCdsCache = undefined;
}

async function getResourceCdsWithCache(): Promise<string[]> {
  if (resourceCdsCache && resourceCdsCache.expiresAt > Date.now()) {
    return resourceCdsCache.value;
  }

  // Keep sharing the query until it settles; the TTL starts on success.
  const entry = { expiresAt: Infinity, value: Promise.resolve([] as string[]) };
  entry.value = queryResourceCds()
    .then((resourceCds) => {
      entry.expiresAt = Date.now() + RESOURCE_CDS_CACHE_TTL_MS;
      return resourceCds;
    })
    .catch((error: unknown) => {
      if (resourceCdsCache === entry) resetProductionScheduleResourceCdsCache();
      throw error;
    });
  resourceCdsCache = entry;
  return entry.value;
}

async function queryResourceCds(): Promise<string[]> {
  const resources = await prisma.$queryRaw<Array<{ resourceCd: string }>>`
    SELECT DISTINCT ("rowData"->>'FSIGENCD') AS "resourceCd"
    FROM "CsvDashboardRow"
    WHERE "csvDashboardId" = ${PRODUCTION_SCHEDULE_DASHBOARD_ID}
      AND ${buildMaxProductNoWinnerCondition('CsvDashboardRow')}
      AND ("rowData"->>'FSIGENCD') IS NOT NULL
      AND ("rowData"->>'FSIGENCD') <> ''
    ORDER BY ("rowData"->>'FSIGENCD') ASC
  `;
  return resources.map((row) => row.resourceCd);
}

export async function listProductionScheduleResources(scope: {
  siteKey?: string;
  deviceScopeKey?: string;
}): Promise<ProductionScheduleResourceListResult> {
  const resourceCds = [...await getResourceCdsWithCache()];
  const policy = await getResourceCategoryPolicy(scope);
  const resourceNameMap = await getResourceNameMapByResourceCds(resourceCds);
  const resourceItems = resourceCds.map((resourceCd) => ({
    resourceCd,
    excluded: isProductionScheduleExcludedCuttingResourceCd(resourceCd, policy)
  }));
  return {
    resources: resourceCds,
    resourceItems,
    resourceNameMap
  };
}
