import { Prisma } from '@prisma/client';
import type { ProductionScheduleResourceCategory } from '@raspi-system/shared-types';

import { prisma } from '../../lib/prisma.js';
import { PRODUCTION_SCHEDULE_DASHBOARD_ID } from './constants.js';
import {
  getResourceCategoryPolicy,
  normalizeProductionScheduleResourceCd,
  type ResourceCategoryPolicy
} from './policies/resource-category-policy.service.js';
import { buildMaxProductNoWinnerCondition } from './row-resolver/index.js';
import { toDueManagementScope, type DueManagementLocationScopeInput } from './due-management-location-scope-adapter.service.js';

type DueManagementResourceFilterParams = {
  resourceCd?: string;
  resourceCategory?: ProductionScheduleResourceCategory;
};

type FseibanRow = {
  fseiban: string;
};

const normalizeFseibanList = (values: string[]): string[] => {
  const unique = new Set<string>();
  values
    .map((value) => value.trim())
    .filter((value) => value.length > 0)
    .forEach((value) => unique.add(value));
  return Array.from(unique);
};

const buildResourceCategoryCondition = (
  resourceCategory: ProductionScheduleResourceCategory | undefined,
  policy: ResourceCategoryPolicy
): Prisma.Sql => {
  const normalizedResourceExpr = Prisma.sql`UPPER(BTRIM("CsvDashboardRow"."rowData"->>'FSIGENCD'))`;
  if (!resourceCategory) {
    return Prisma.empty;
  }

  const grindingCds = policy.grindingResourceCds.map((cd) => Prisma.sql`${cd}`);
  if (resourceCategory === 'grinding') {
    return Prisma.sql`AND ${normalizedResourceExpr} IN (${Prisma.join(grindingCds, ',')})`;
  }

  const excludedCds = policy.cuttingExcludedResourceCds.map((cd) => Prisma.sql`${cd}`);
  if (excludedCds.length === 0) {
    return Prisma.sql`AND ${normalizedResourceExpr} NOT IN (${Prisma.join(grindingCds, ',')})`;
  }

  return Prisma.sql`AND ${normalizedResourceExpr} NOT IN (${Prisma.join(grindingCds, ',')}) AND ${normalizedResourceExpr} NOT IN (${Prisma.join(excludedCds, ',')})`;
};

export const normalizeDueManagementResourceFilter = (
  params: DueManagementResourceFilterParams | undefined
): DueManagementResourceFilterParams & { resourceCd: string } => {
  const resourceCd = params?.resourceCd ? normalizeProductionScheduleResourceCd(params.resourceCd) : '';
  return {
    resourceCd,
    resourceCategory: params?.resourceCategory
  };
};

export const hasDueManagementResourceFilter = (
  params: DueManagementResourceFilterParams | undefined
): boolean => {
  const normalized = normalizeDueManagementResourceFilter(params);
  return normalized.resourceCd.length > 0 || typeof normalized.resourceCategory === 'string';
};

export async function listDueManagementFilteredFseibans(params: {
  locationScope: DueManagementLocationScopeInput;
  targetFseibans?: string[];
  filter: DueManagementResourceFilterParams;
}): Promise<string[]> {
  const scope = toDueManagementScope(params.locationScope);
  const normalizedFilter = normalizeDueManagementResourceFilter(params.filter);
  const normalizedTargetFseibans = normalizeFseibanList(params.targetFseibans ?? []);
  if (params.targetFseibans && normalizedTargetFseibans.length === 0) {
    return [];
  }

  const policy = await getResourceCategoryPolicy({
    siteKey: scope.siteKey,
    deviceScopeKey: scope.deviceScopeKey
  });
  const resourceCategoryCondition = buildResourceCategoryCondition(normalizedFilter.resourceCategory, policy);
  const normalizedResourceExpr = Prisma.sql`UPPER(BTRIM("CsvDashboardRow"."rowData"->>'FSIGENCD'))`;
  const targetFseibanCondition =
    normalizedTargetFseibans.length > 0
      ? Prisma.sql`AND ("CsvDashboardRow"."rowData"->>'FSEIBAN') IN (${Prisma.join(
          normalizedTargetFseibans.map((fseiban) => Prisma.sql`${fseiban}`),
          ','
        )})`
      : Prisma.empty;
  const resourceCdCondition =
    normalizedFilter.resourceCd.length > 0
      ? Prisma.sql`AND ${normalizedResourceExpr} = ${normalizedFilter.resourceCd}`
      : Prisma.empty;

  const rows = await prisma.$queryRaw<FseibanRow[]>`
    SELECT DISTINCT ("CsvDashboardRow"."rowData"->>'FSEIBAN') AS "fseiban"
    FROM "CsvDashboardRow"
    WHERE "CsvDashboardRow"."csvDashboardId" = ${PRODUCTION_SCHEDULE_DASHBOARD_ID}
      AND ${buildMaxProductNoWinnerCondition('CsvDashboardRow')}
      AND NULLIF(TRIM("CsvDashboardRow"."rowData"->>'FSEIBAN'), '') IS NOT NULL
      ${targetFseibanCondition}
      ${resourceCdCondition}
      ${resourceCategoryCondition}
    ORDER BY ("CsvDashboardRow"."rowData"->>'FSEIBAN') ASC
  `;

  return rows.map((row) => row.fseiban.trim()).filter((fseiban) => fseiban.length > 0);
}
