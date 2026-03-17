import { Prisma } from '@prisma/client';
import {
  type ProductionScheduleResourceCategory
} from '@raspi-system/shared-types';

import { prisma } from '../../lib/prisma.js';
import { createActualHoursFeatureResolver } from './actual-hours-feature-resolver.service.js';
import {
  pickActualHoursRowsByLocationPriority,
  resolveActualHoursLocationCandidates
} from './actual-hours-location-scope.service.js';
import { COMPLETED_PROGRESS_VALUE, PRODUCTION_SCHEDULE_DASHBOARD_ID } from './constants.js';
import { GLOBAL_SHARED_LOCATION_KEY } from './due-management-ranking-scope-policy.service.js';
import {
  filterProductionScheduleResourceCdsByCategoryWithPolicy,
  getResourceCategoryPolicy,
  isProductionScheduleExcludedCuttingResourceCd,
  normalizeProductionScheduleResourceCd,
  type ResourceCategoryPolicy
} from './policies/resource-category-policy.service.js';
import {
  getResourceGroupCandidatesByResourceCds,
  getResourceNameMapByResourceCds,
  type ProductionScheduleResourceNameMap
} from './resource-master.service.js';
import { buildMaxProductNoWinnerCondition } from './row-resolver/index.js';

type ProductionScheduleRow = {
  id: string;
  occurredAt: Date;
  rowData: Prisma.JsonValue;
  processingOrder: number | null;
  globalRank: number | null;
  actualPerPieceMinutes: number | null;
  note: string | null;
  processingType: string | null;
  dueDate: Date | null;
};

export type ProductionScheduleListParams = {
  page: number;
  pageSize: number;
  queryText: string;
  machineName?: string;
  resourceCds: string[];
  assignedOnlyCds: string[];
  resourceCategory?: ProductionScheduleResourceCategory;
  hasNoteOnly: boolean;
  hasDueDateOnly: boolean;
  locationKey: string;
  siteKey?: string;
};

export type ProductionScheduleOrderUsageParams = {
  locationKey: string;
  resourceCds: string[];
};

const buildTextConditions = (queryText: string): Prisma.Sql[] => {
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
    const isNumeric = /^\d+$/.test(token);
    const isFseiban = /^[A-Za-z0-9*]{8}$/.test(token);
    const likeValue = `%${token}%`;
    if (isNumeric) {
      textConditions.push(Prisma.sql`("CsvDashboardRow"."rowData"->>'ProductNo') ILIKE ${likeValue}`);
    } else if (isFseiban) {
      textConditions.push(Prisma.sql`("CsvDashboardRow"."rowData"->>'FSEIBAN') = ${token}`);
    } else {
      textConditions.push(
        Prisma.sql`(("CsvDashboardRow"."rowData"->>'ProductNo') ILIKE ${likeValue} OR ("CsvDashboardRow"."rowData"->>'FSEIBAN') ILIKE ${likeValue})`
      );
    }
  }
  return textConditions;
};

const buildResourceConditions = (params: {
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
    resourceConditions.push(
      Prisma.sql`"CsvDashboardRow"."id" IN (
        SELECT "csvDashboardRowId"
        FROM "ProductionScheduleOrderAssignment"
        WHERE "csvDashboardId" = ${PRODUCTION_SCHEDULE_DASHBOARD_ID}
          AND "location" = ${locationKey}
          AND "resourceCd" IN (${Prisma.join(
            normalizedAssignedOnlyCds.map((cd) => Prisma.sql`${cd}`),
            ','
          )})
      )`
    );
  }

  return resourceConditions;
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

const buildQueryWhere = (params: {
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
    queryWhere = Prisma.sql`${queryWhere} AND "CsvDashboardRow"."id" IN (
      SELECT "csvDashboardRowId" FROM "ProductionScheduleRowNote"
      WHERE "csvDashboardId" = ${PRODUCTION_SCHEDULE_DASHBOARD_ID}
        AND "dueDate" IS NOT NULL
    )`;
  }
  return queryWhere;
};

export async function listProductionScheduleRows(params: ProductionScheduleListParams): Promise<{
  page: number;
  pageSize: number;
  total: number;
  rows: ProductionScheduleRow[];
}> {
  const {
    page,
    pageSize,
    queryText,
    machineName,
    resourceCds,
    assignedOnlyCds,
    resourceCategory,
    hasNoteOnly,
    hasDueDateOnly,
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
  const normalizedMachineName = machineName?.trim().toUpperCase() ?? '';
  const machineNameCondition =
    normalizedMachineName.length > 0
      ? Prisma.sql`AND EXISTS (
          SELECT 1
          FROM "CsvDashboardRow" AS "MachineRow"
          WHERE "MachineRow"."csvDashboardId" = ${PRODUCTION_SCHEDULE_DASHBOARD_ID}
            AND ${buildMaxProductNoWinnerCondition('MachineRow')}
            AND ("MachineRow"."rowData"->>'FSEIBAN') = ("CsvDashboardRow"."rowData"->>'FSEIBAN')
            AND (
              UPPER(COALESCE("MachineRow"."rowData"->>'FHINCD', '')) LIKE 'MH%'
              OR UPPER(COALESCE("MachineRow"."rowData"->>'FHINCD', '')) LIKE 'SH%'
            )
            AND UPPER(BTRIM(COALESCE("MachineRow"."rowData"->>'FHINMEI', ''))) = ${normalizedMachineName}
        )`
      : Prisma.empty;

  // 登録製番なし かつ 割当なし の場合は検索しない。
  // - 資源CD単独（resourceCds）
  // - 工程カテゴリ単独（resourceCategory）
  // - 資源CD + 工程カテゴリ（resourceCds + resourceCategory）
  // はいずれも0件を返す。
  // 割当のみは対象が少ないため単独検索を許可する。
  const hasOnlyResourceFilters =
    textConditions.length === 0 &&
    normalizedMachineName.length === 0 &&
    filteredAssignedOnlyCds.length === 0 &&
    (filteredResourceCds.length > 0 || resourceCategory !== undefined);

  if (hasOnlyResourceFilters) {
    return {
      page,
      pageSize,
      total: 0,
      rows: []
    };
  }

  const baseWhere = Prisma.sql`
    "CsvDashboardRow"."csvDashboardId" = ${PRODUCTION_SCHEDULE_DASHBOARD_ID}
    AND ${buildMaxProductNoWinnerCondition('CsvDashboardRow')}
  `;
  const queryWhere = buildQueryWhere({
    textConditions,
    resourceConditions,
    resourceCategoryCondition,
    machineNameCondition,
    hasNoteOnly,
    hasDueDateOnly
  });

  const countRows = await prisma.$queryRaw<Array<{ total: bigint }>>`
    SELECT COUNT(*)::bigint AS total
    FROM "CsvDashboardRow"
    WHERE ${baseWhere} ${queryWhere}
  `;
  const total = Number(countRows[0]?.total ?? 0n);

  const offset = (page - 1) * pageSize;
  const rows = await prisma.$queryRaw<ProductionScheduleRow[]>`
    SELECT
      "CsvDashboardRow"."id",
      "CsvDashboardRow"."occurredAt",
      jsonb_build_object(
        'ProductNo', "CsvDashboardRow"."rowData"->>'ProductNo',
        'FSEIBAN', "CsvDashboardRow"."rowData"->>'FSEIBAN',
        'FHINCD', "CsvDashboardRow"."rowData"->>'FHINCD',
        'FHINMEI', "CsvDashboardRow"."rowData"->>'FHINMEI',
        'FSIGENCD', "CsvDashboardRow"."rowData"->>'FSIGENCD',
        'FSIGENSHOYORYO', "CsvDashboardRow"."rowData"->>'FSIGENSHOYORYO',
        'FKOJUN', "CsvDashboardRow"."rowData"->>'FKOJUN',
        'progress', (CASE WHEN COALESCE("p"."isCompleted", FALSE) THEN ${COMPLETED_PROGRESS_VALUE} ELSE '' END)
      ) AS "rowData",
      (
        SELECT "orderNumber"
        FROM "ProductionScheduleOrderAssignment"
        WHERE "csvDashboardRowId" = "CsvDashboardRow"."id"
          AND "location" = ${locationKey}
        LIMIT 1
      ) AS "processingOrder",
      (
        SELECT "globalRank"
        FROM "ProductionScheduleGlobalRowRank"
        WHERE "csvDashboardRowId" = "CsvDashboardRow"."id"
          AND "csvDashboardId" = ${PRODUCTION_SCHEDULE_DASHBOARD_ID}
          AND "location" IN (${GLOBAL_SHARED_LOCATION_KEY}, ${locationKey})
        ORDER BY CASE WHEN "location" = ${GLOBAL_SHARED_LOCATION_KEY} THEN 0 ELSE 1 END ASC
        LIMIT 1
      ) AS "globalRank",
      NULLIF(TRIM("n"."note"), '') AS "note",
      COALESCE("pp"."processingType", "n"."processingType") AS "processingType",
      "n"."dueDate" AS "dueDate"
    FROM "CsvDashboardRow"
    LEFT JOIN "ProductionScheduleProgress" AS "p"
      ON "p"."csvDashboardRowId" = "CsvDashboardRow"."id"
      AND "p"."csvDashboardId" = ${PRODUCTION_SCHEDULE_DASHBOARD_ID}
    LEFT JOIN "ProductionScheduleRowNote" AS "n"
      ON "n"."csvDashboardRowId" = "CsvDashboardRow"."id"
      AND "n"."csvDashboardId" = ${PRODUCTION_SCHEDULE_DASHBOARD_ID}
    LEFT JOIN "ProductionSchedulePartProcessingType" AS "pp"
      ON "pp"."csvDashboardId" = ${PRODUCTION_SCHEDULE_DASHBOARD_ID}
      AND "pp"."fhincd" = ("CsvDashboardRow"."rowData"->>'FHINCD')
    WHERE ${baseWhere} ${queryWhere}
    ORDER BY
      ("CsvDashboardRow"."rowData"->>'FSEIBAN') ASC,
      ("CsvDashboardRow"."rowData"->>'ProductNo') ASC,
      (CASE
        WHEN ("CsvDashboardRow"."rowData"->>'FKOJUN') ~ '^\\d+$' THEN (("CsvDashboardRow"."rowData"->>'FKOJUN'))::int
        ELSE NULL
      END) ASC,
      ("CsvDashboardRow"."rowData"->>'FHINCD') ASC
    LIMIT ${pageSize} OFFSET ${offset}
  `;

  const rowResourceCds = rows
    .map((row) => {
      const rowData = (row.rowData ?? {}) as Record<string, unknown>;
      return typeof rowData.FSIGENCD === 'string' ? rowData.FSIGENCD.trim() : '';
    })
    .filter((resourceCd) => resourceCd.length > 0);
  const actualHoursLocationCandidates = resolveActualHoursLocationCandidates(locationKey);
  const [featureRowsWithLocation, resourceCodeMappings, resourceGroupCandidatesByResourceCd] = await Promise.all([
    prisma.productionScheduleActualHoursFeature.findMany({
      where: {
        csvDashboardId: PRODUCTION_SCHEDULE_DASHBOARD_ID,
        location: { in: actualHoursLocationCandidates }
      },
      select: {
        location: true,
        fhincd: true,
        resourceCd: true,
        medianPerPieceMinutes: true,
        p75PerPieceMinutes: true
      }
    }),
    prisma.productionScheduleResourceCodeMapping.findMany({
      where: {
        csvDashboardId: PRODUCTION_SCHEDULE_DASHBOARD_ID,
        location: locationKey,
        enabled: true
      },
      orderBy: [{ fromResourceCd: 'asc' }, { priority: 'asc' }, { toResourceCd: 'asc' }],
      select: {
        fromResourceCd: true,
        toResourceCd: true,
        priority: true,
        enabled: true
      }
    }),
    getResourceGroupCandidatesByResourceCds(rowResourceCds)
  ]);
  const featureRows = pickActualHoursRowsByLocationPriority(
    featureRowsWithLocation,
    actualHoursLocationCandidates
  ).map((row) => ({
    fhincd: row.fhincd,
    resourceCd: row.resourceCd,
    medianPerPieceMinutes: row.medianPerPieceMinutes,
    p75PerPieceMinutes: row.p75PerPieceMinutes
  }));
  const featureResolver = createActualHoursFeatureResolver({
    features: featureRows,
    resourceCodeMappings,
    resourceGroupCandidatesByResourceCd
  });

  const rowsWithActualHours = rows.map((row) => {
    const rowData = (row.rowData ?? {}) as Record<string, unknown>;
    const fhincd = typeof rowData.FHINCD === 'string' ? rowData.FHINCD.trim() : '';
    const resourceCd = typeof rowData.FSIGENCD === 'string' ? rowData.FSIGENCD.trim() : '';
    const perPieceMinutes = featureResolver.resolve({ fhincd, resourceCd }).perPieceMinutes;
    return {
      ...row,
      actualPerPieceMinutes: perPieceMinutes
    };
  });

  return {
    page,
    pageSize,
    total,
    rows: rowsWithActualHours
  };
}

export type ProductionScheduleResourceListResult = {
  resources: string[];
  resourceItems: Array<{
    resourceCd: string;
    excluded: boolean;
  }>;
  resourceNameMap: ProductionScheduleResourceNameMap;
};

export async function listProductionScheduleResources(scope: {
  siteKey?: string;
  deviceScopeKey?: string;
}): Promise<ProductionScheduleResourceListResult> {
  const resources = await prisma.$queryRaw<Array<{ resourceCd: string }>>`
    SELECT DISTINCT ("rowData"->>'FSIGENCD') AS "resourceCd"
    FROM "CsvDashboardRow"
    WHERE "csvDashboardId" = ${PRODUCTION_SCHEDULE_DASHBOARD_ID}
      AND ${buildMaxProductNoWinnerCondition('CsvDashboardRow')}
      AND ("rowData"->>'FSIGENCD') IS NOT NULL
      AND ("rowData"->>'FSIGENCD') <> ''
    ORDER BY ("rowData"->>'FSIGENCD') ASC
  `;
  const resourceCds = resources.map((row) => row.resourceCd);
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

export async function getProductionScheduleOrderUsage(
  params: ProductionScheduleOrderUsageParams
): Promise<Record<string, number[]>> {
  const { locationKey, resourceCds } = params;
  const usageRows = await prisma.$queryRaw<Array<{ resourceCd: string; orderNumbers: number[] }>>`
    SELECT
      "resourceCd" AS "resourceCd",
      array_agg("orderNumber" ORDER BY "orderNumber") AS "orderNumbers"
    FROM "ProductionScheduleOrderAssignment"
    WHERE "csvDashboardId" = ${PRODUCTION_SCHEDULE_DASHBOARD_ID}
      AND "location" = ${locationKey}
      ${
        resourceCds.length > 0
          ? Prisma.sql`AND "resourceCd" IN (${Prisma.join(
              resourceCds.map((cd) => Prisma.sql`${cd}`),
              ','
            )})`
          : Prisma.empty
      }
    GROUP BY "resourceCd"
  `;

  return usageRows.reduce<Record<string, number[]>>((acc, row) => {
    acc[row.resourceCd] = row.orderNumbers ?? [];
    return acc;
  }, {});
}
