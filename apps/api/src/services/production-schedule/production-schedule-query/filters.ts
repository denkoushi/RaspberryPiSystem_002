import { Prisma } from '@prisma/client';
import {
  type ProductionScheduleResourceCategory
} from '@raspi-system/shared-types';

import {
  PRODUCTION_SCHEDULE_DASHBOARD_ID,
} from '../constants.js';
import { buildMaxProductNoWinnerCondition } from '../row-resolver/index.js';
import { normalizeMachineNameForCompare } from '../machine-name-compare.js';
import { resolveMatchingFseibansByNormalizedMachineName } from '../machine-name-fseiban-match.service.js';
import {
  filterProductionScheduleResourceCdsByCategoryWithPolicy,
  getResourceCategoryPolicy,
  normalizeProductionScheduleResourceCd,
  type ResourceCategoryPolicy
} from '../policies/resource-category-policy.service.js';
import { isProductionScheduleOrderSplitEnabled } from '../order-split/production-schedule-order-split-feature.js';
import type { ProductionScheduleListParams } from './types.js';

export type PreparedProductionScheduleDashboardFilters =
  | { kind: 'blocked_empty_search' }
  | {
      kind: 'ready';
      baseWhere: Prisma.Sql;
      queryWhere: Prisma.Sql;
      leaderboardExpansionWhere: Prisma.Sql;
      /** `siteKey` 優先。global rank 選択に使用。 */
      siteScopedGlobalRankLocation: string;
    };

export async function prepareProductionScheduleDashboardFilters(
  params: Omit<ProductionScheduleListParams, 'page' | 'pageSize' | 'responseProfile'>
): Promise<PreparedProductionScheduleDashboardFilters> {
  const {
    queryText,
    productNos,
    machineName,
    resourceCds,
    assignedOnlyCds,
    resourceCategory,
    hasNoteOnly,
    hasDueDateOnly,
    allowResourceOnly = false,
    locationKey,
    siteKey
  } = params;

  const textConditions = buildTextConditions(queryText);
  const resourceCategoryPolicy = await getResourceCategoryPolicy({
    siteKey,
    deviceScopeKey: locationKey
  });
  const filteredResourceCds = filterProductionScheduleResourceCdsByCategoryWithPolicy(
    resourceCds,
    resourceCategory,
    resourceCategoryPolicy
  );
  const filteredAssignedOnlyCds = filterProductionScheduleResourceCdsByCategoryWithPolicy(
    assignedOnlyCds,
    resourceCategory,
    resourceCategoryPolicy
  );
  const resourceConditions = buildResourceConditions({
    resourceCds: filteredResourceCds,
    assignedOnlyCds: filteredAssignedOnlyCds,
    locationKey
  });
  const resourceCategoryCondition = buildResourceCategoryCondition(resourceCategory, resourceCategoryPolicy);
  const machineNameCondition = await buildMachineNameCondition(machineName);
  const productNoCondition = buildProductNoCondition(productNos);

  const hasOnlyResourceFilters =
    textConditions.length === 0 &&
    normalizeMachineNameForCompare(machineName).length === 0 &&
    productNos.length === 0 &&
    filteredAssignedOnlyCds.length === 0 &&
    (filteredResourceCds.length > 0 || resourceCategory !== undefined);

  if (hasOnlyResourceFilters && !allowResourceOnly) {
    return { kind: 'blocked_empty_search' };
  }

  const baseWhere = Prisma.sql`
    "CsvDashboardRow"."csvDashboardId" = ${PRODUCTION_SCHEDULE_DASHBOARD_ID}
    AND ${buildMaxProductNoWinnerCondition('CsvDashboardRow')}
  `;
  const queryWhere = Prisma.sql`${buildQueryWhere({
    textConditions,
    resourceConditions,
    resourceCategoryCondition,
    machineNameCondition,
    hasNoteOnly,
    hasDueDateOnly
  })} ${productNoCondition}`;
  const leaderboardExpansionWhere = buildQueryWhere({
    textConditions: [],
    resourceConditions,
    resourceCategoryCondition,
    machineNameCondition: Prisma.empty,
    hasNoteOnly: false,
    hasDueDateOnly: false
  });

  const siteScopedGlobalRankLocation = siteKey?.trim().length ? siteKey.trim() : locationKey;

  return {
    kind: 'ready',
    baseWhere,
    queryWhere,
    leaderboardExpansionWhere,
    siteScopedGlobalRankLocation
  };
}

export const buildTextConditions = (queryText: string): Prisma.Sql[] => {
  const tokens = Array.from(
    new Set(
      queryText
        .split(',')
        .map((token) => token.trim())
        .filter((token) => token.length > 0)
    )
  ).slice(0, 8);

  const textConditions: Prisma.Sql[] = [];
  for (const token of tokens) {
    const isEightCharSeibanToken = /^[A-Za-z0-9*]{8}$/.test(token);
    const isNumeric = /^\d+$/.test(token);
    const likeValue = `%${token}%`;
    if (isEightCharSeibanToken) {
      textConditions.push(
        Prisma.sql`(("CsvDashboardRow"."rowData"->>'FSEIBAN') = ${token} OR ("CsvDashboardRow"."rowData"->>'ProductNo') ILIKE ${likeValue} OR ("CsvDashboardRow"."rowData"->>'FHINCD') ILIKE ${likeValue})`
      );
    } else if (isNumeric) {
      textConditions.push(
        Prisma.sql`(("CsvDashboardRow"."rowData"->>'ProductNo') ILIKE ${likeValue} OR ("CsvDashboardRow"."rowData"->>'FHINCD') ILIKE ${likeValue})`
      );
    } else {
      textConditions.push(
        Prisma.sql`(("CsvDashboardRow"."rowData"->>'ProductNo') ILIKE ${likeValue} OR ("CsvDashboardRow"."rowData"->>'FSEIBAN') ILIKE ${likeValue} OR ("CsvDashboardRow"."rowData"->>'FHINCD') ILIKE ${likeValue})`
      );
    }
  }
  return textConditions;
};

export const buildResourceConditions = (params: {
  resourceCds: string[];
  assignedOnlyCds: string[];
  locationKey: string;
}): Prisma.Sql[] => {
  const { locationKey, resourceCds, assignedOnlyCds } = params;
  const normalizedResourceExpr = Prisma.sql`UPPER(BTRIM("CsvDashboardRow"."rowData"->>'FSIGENCD'))`;
  const normalizedResourceCds = resourceCds.map((cd) => normalizeProductionScheduleResourceCd(cd));
  const normalizedAssignedOnlyCds = assignedOnlyCds.map((cd) => normalizeProductionScheduleResourceCd(cd));
  const resourceConditions: Prisma.Sql[] = [];

  if (normalizedResourceCds.length > 0) {
    resourceConditions.push(
      Prisma.sql`${normalizedResourceExpr} IN (${Prisma.join(
        normalizedResourceCds.map((cd) => Prisma.sql`${cd}`),
        ','
      )})`
    );
  }

  if (normalizedAssignedOnlyCds.length > 0) {
    const resourceCdFilter = Prisma.join(
      normalizedAssignedOnlyCds.map((cd) => Prisma.sql`${cd}`),
      ','
    );
    const parentAssignmentSubquery = Prisma.sql`
      SELECT "csvDashboardRowId"
      FROM "ProductionScheduleOrderAssignment"
      WHERE "csvDashboardId" = ${PRODUCTION_SCHEDULE_DASHBOARD_ID}
        AND (
          "location" = ${locationKey}
          OR "siteKey" = ${locationKey}
        )
        AND "resourceCd" IN (${resourceCdFilter})
    `;
    const assignedOnlyParentRowSubquery = isProductionScheduleOrderSplitEnabled()
      ? Prisma.sql`
        ${parentAssignmentSubquery}
        UNION
        SELECT "s"."parentCsvDashboardRowId"
        FROM "ProductionScheduleOrderSplitAssignment" AS "sa"
        INNER JOIN "ProductionScheduleOrderSplit" AS "s"
          ON "s"."id" = "sa"."splitId"
          AND "s"."csvDashboardId" = ${PRODUCTION_SCHEDULE_DASHBOARD_ID}
        WHERE "sa"."csvDashboardId" = ${PRODUCTION_SCHEDULE_DASHBOARD_ID}
          AND (
            "sa"."location" = ${locationKey}
            OR "sa"."siteKey" = ${locationKey}
          )
          AND "sa"."resourceCd" IN (${resourceCdFilter})
      `
      : parentAssignmentSubquery;

    resourceConditions.push(
      Prisma.sql`"CsvDashboardRow"."id" IN (${assignedOnlyParentRowSubquery})`
    );
  }

  return resourceConditions;
};

export const buildResourceCategoryCondition = (
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

export const buildQueryWhere = (params: {
  textConditions: Prisma.Sql[];
  resourceConditions: Prisma.Sql[];
  resourceCategoryCondition: Prisma.Sql;
  machineNameCondition: Prisma.Sql;
  hasNoteOnly: boolean;
  hasDueDateOnly: boolean;
}): Prisma.Sql => {
  const {
    textConditions,
    resourceConditions,
    resourceCategoryCondition,
    machineNameCondition,
    hasNoteOnly,
    hasDueDateOnly
  } = params;

  const textWhere =
    textConditions.length > 0 ? Prisma.sql`(${Prisma.join(textConditions, ' OR ')})` : Prisma.empty;
  const resourceWhere =
    resourceConditions.length > 0
      ? Prisma.sql`(${Prisma.join(resourceConditions, ' OR ')})`
      : Prisma.empty;

  let queryWhere =
    textConditions.length > 0 && resourceConditions.length > 0
      ? Prisma.sql`AND ${textWhere} AND ${resourceWhere}`
      : textConditions.length > 0
        ? Prisma.sql`AND ${textWhere}`
        : resourceConditions.length > 0
          ? Prisma.sql`AND ${resourceWhere}`
          : Prisma.empty;

  queryWhere = Prisma.sql`${queryWhere} ${resourceCategoryCondition} ${machineNameCondition}`;

  if (hasNoteOnly) {
    queryWhere = Prisma.sql`${queryWhere} AND "CsvDashboardRow"."id" IN (
      SELECT "csvDashboardRowId" FROM "ProductionScheduleRowNote"
      WHERE "csvDashboardId" = ${PRODUCTION_SCHEDULE_DASHBOARD_ID}
        AND TRIM("note") <> ''
    )`;
  }
  if (hasDueDateOnly) {
    const parentDueDateExists = Prisma.sql`"CsvDashboardRow"."id" IN (
      SELECT "csvDashboardRowId" FROM "ProductionScheduleRowNote"
      WHERE "csvDashboardId" = ${PRODUCTION_SCHEDULE_DASHBOARD_ID}
        AND "dueDate" IS NOT NULL
    )`;
    const splitDueDateExists = isProductionScheduleOrderSplitEnabled()
      ? Prisma.sql` OR "CsvDashboardRow"."id" IN (
          SELECT "parentCsvDashboardRowId" FROM "ProductionScheduleOrderSplit"
          WHERE "csvDashboardId" = ${PRODUCTION_SCHEDULE_DASHBOARD_ID}
            AND "dueDate" IS NOT NULL
        )`
      : Prisma.empty;
    queryWhere = Prisma.sql`${queryWhere} AND (${parentDueDateExists}${splitDueDateExists})`;
  }
  return queryWhere;
};

export const buildProductNoCondition = (productNos: string[]): Prisma.Sql => {
  const normalized = Array.from(
    new Set(
      productNos
        .map((token) => token.trim())
        .filter((token) => token.length > 0)
    )
  );
  if (normalized.length === 0) {
    return Prisma.empty;
  }
  return Prisma.sql`AND ("CsvDashboardRow"."rowData"->>'ProductNo') IN (${Prisma.join(
    normalized.map((value) => Prisma.sql`${value}`),
    ','
  )})`;
};

export const listMatchingFseibansByMachineName = async (normalizedMachineName: string): Promise<string[]> =>
  resolveMatchingFseibansByNormalizedMachineName(normalizedMachineName);

export const buildMachineNameCondition = async (machineName: string | undefined): Promise<Prisma.Sql> => {
  const normalizedMachineName = normalizeMachineNameForCompare(machineName);
  if (normalizedMachineName.length === 0) {
    return Prisma.empty;
  }
  const matchingFseibans = await listMatchingFseibansByMachineName(normalizedMachineName);
  if (matchingFseibans.length === 0) {
    return Prisma.sql`AND 1 = 0`;
  }
  return Prisma.sql`AND ("CsvDashboardRow"."rowData"->>'FSEIBAN') IN (${Prisma.join(
    matchingFseibans.map((value) => Prisma.sql`${value}`),
    ','
  )})`;
};
