import { Prisma } from '@prisma/client';
import {
  type ProductionScheduleResourceCategory
} from '@raspi-system/shared-types';

import { prisma } from '../../../lib/prisma.js';
import {
  PRODUCTION_SCHEDULE_DASHBOARD_ID,
} from '../constants.js';
import { buildMaxProductNoWinnerCondition } from '../row-resolver/index.js';
import { normalizeMachineNameForCompare } from '../machine-name-compare.js';
import {
  filterProductionScheduleResourceCdsByCategoryWithPolicy,
  getResourceCategoryPolicy,
} from '../policies/resource-category-policy.service.js';
import {
  buildMachineNameCondition,
  buildResourceCategoryCondition,
  buildResourceConditions,
} from './filters.js';

export type ProductionScheduleOrderSearchParams = {
  locationKey: string;
  siteKey?: string;
  resourceCds: string[];
  resourceCategory?: ProductionScheduleResourceCategory;
  machineName?: string;
  productNoPrefix: string;
  partName?: string;
};

export type ProductionScheduleOrderSearchResult = {
  partNameOptions: string[];
  orders: string[];
};

export async function searchProductionScheduleOrders(
  params: ProductionScheduleOrderSearchParams
): Promise<ProductionScheduleOrderSearchResult> {
  const {
    locationKey,
    siteKey,
    resourceCds,
    resourceCategory,
    machineName,
    productNoPrefix,
    partName
  } = params;
  const resourceCategoryPolicy = await getResourceCategoryPolicy({
    siteKey,
    deviceScopeKey: locationKey
  });
  const filteredResourceCds = filterProductionScheduleResourceCdsByCategoryWithPolicy(
    resourceCds,
    resourceCategory,
    resourceCategoryPolicy
  );
  const resourceConditions = buildResourceConditions({
    resourceCds: filteredResourceCds,
    assignedOnlyCds: [],
    locationKey
  });
  const resourceCategoryCondition = buildResourceCategoryCondition(resourceCategory, resourceCategoryPolicy);
  const machineNameCondition = await buildMachineNameCondition(machineName);
  const partNameCondition =
    typeof partName === 'string' && partName.trim().length > 0
      ? Prisma.sql`AND ("CsvDashboardRow"."rowData"->>'FHINMEI') = ${partName.trim()}`
      : Prisma.empty;

  const resourceWhere =
    resourceConditions.length > 0
      ? Prisma.sql`AND (${Prisma.join(resourceConditions, ' OR ')})`
      : Prisma.empty;

  const rows = await prisma.$queryRaw<Array<{ productNo: string | null; partName: string | null }>>`
    SELECT
      "CsvDashboardRow"."rowData"->>'ProductNo' AS "productNo",
      "CsvDashboardRow"."rowData"->>'FHINMEI' AS "partName"
    FROM "CsvDashboardRow"
    WHERE "CsvDashboardRow"."csvDashboardId" = ${PRODUCTION_SCHEDULE_DASHBOARD_ID}
      AND ${buildMaxProductNoWinnerCondition('CsvDashboardRow')}
      AND ("CsvDashboardRow"."rowData"->>'ProductNo') IS NOT NULL
      AND ("CsvDashboardRow"."rowData"->>'ProductNo') LIKE ${`${productNoPrefix}%`}
      AND (
        UPPER(COALESCE("CsvDashboardRow"."rowData"->>'FHINCD', '')) NOT LIKE 'MH%'
        AND UPPER(COALESCE("CsvDashboardRow"."rowData"->>'FHINCD', '')) NOT LIKE 'SH%'
      )
      ${resourceWhere}
      ${resourceCategoryCondition}
      ${machineNameCondition}
      ${partNameCondition}
    ORDER BY ("CsvDashboardRow"."rowData"->>'ProductNo') ASC
  `;

  const partNameMap = new Map<string, string>();
  rows.forEach((row) => {
    const currentPartName = String(row.partName ?? '').trim();
    if (currentPartName.length === 0) return;
    const key = normalizeMachineNameForCompare(currentPartName);
    if (!partNameMap.has(key)) {
      partNameMap.set(key, currentPartName);
    }
  });
  const partNameOptions = Array.from(partNameMap.values()).sort((a, b) => a.localeCompare(b, 'ja'));

  const orders =
    typeof partName === 'string' && partName.trim().length > 0
      ? rows
          .map((row) => String(row.productNo ?? '').trim())
          .filter((value) => value.length > 0)
      : [];

  return {
    partNameOptions,
    orders
  };
}
