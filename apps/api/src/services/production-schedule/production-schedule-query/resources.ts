import { logger } from '../../../lib/logger.js';
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
let resourceCdsCache: {
  expiresAt: number;
  generation: number;
  value?: string[];
  inFlight?: Promise<string[]>;
} | undefined;

export function resetProductionScheduleResourceCdsCache(): void {
  resourceCdsCache = undefined;
}

export function markProductionScheduleResourceCdsCacheStale(): void {
  if (!resourceCdsCache?.value) {
    resetProductionScheduleResourceCdsCache();
    return;
  }
  resourceCdsCache.expiresAt = -Infinity;
  resourceCdsCache.generation += 1;
}

async function getResourceCdsWithCache(): Promise<string[]> {
  const entry = resourceCdsCache ??= { expiresAt: -Infinity, generation: 0 };
  if (entry.value && entry.expiresAt > Date.now()) return entry.value;

  if (!entry.inFlight) {
    const generation = entry.generation;
    entry.inFlight = queryResourceCds()
      .then((resourceCds) => {
        if (resourceCdsCache === entry) {
          entry.value = resourceCds;
          // An import during this query keeps its result stale.
          entry.expiresAt = entry.generation === generation ? Date.now() + RESOURCE_CDS_CACHE_TTL_MS : -Infinity;
        }
        return resourceCds;
      })
      .finally(() => {
        if (resourceCdsCache === entry) entry.inFlight = undefined;
      });
    if (entry.value) {
      void entry.inFlight.catch((err: unknown) => {
        logger.warn({ err }, 'Failed to refresh production schedule resource codes cache');
      });
    }
  }
  return entry.value ?? entry.inFlight;
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
