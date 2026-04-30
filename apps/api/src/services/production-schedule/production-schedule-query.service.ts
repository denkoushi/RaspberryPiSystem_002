import { Prisma } from '@prisma/client';
import {
  type ProductionScheduleResourceCategory
} from '@raspi-system/shared-types';

import { prisma } from '../../lib/prisma.js';
import { loadActualHoursReadContext } from './actual-hours/actual-hours-read-context.service.js';
import {
  COMPLETED_PROGRESS_VALUE,
  PRODUCTION_SCHEDULE_DASHBOARD_ID,
  PRODUCTION_SCHEDULE_SEIBAN_MACHINE_NAME_SUPPLEMENT_DASHBOARD_ID,
} from './constants.js';
import {
  buildFkojunstProductionScheduleListRowDataFkojunstSql,
  buildFkojunstProductionScheduleListVisibilityWhereSql,
} from './policies/fkojunst-production-schedule-list-visibility.policy.js';
import { GLOBAL_SHARED_LOCATION_KEY } from './due-management-ranking-scope-policy.service.js';
import {
  filterProductionScheduleResourceCdsByCategoryWithPolicy,
  getResourceCategoryPolicy,
  isProductionScheduleExcludedCuttingResourceCd,
  normalizeProductionScheduleResourceCd,
  type ResourceCategoryPolicy
} from './policies/resource-category-policy.service.js';
import {
  getResourceNameMapByResourceCds,
  type ProductionScheduleResourceNameMap
} from './resource-master.service.js';
import { buildMaxProductNoWinnerCondition } from './row-resolver/index.js';
import { enrichProductionScheduleRowsWithResolvedMachineName } from './production-schedule-machine-name-enrichment.service.js';
import { enrichProductionScheduleRowsWithCustomerName } from './production-schedule-customer-name-enrichment.service.js';

/** 機種名比較用: 全角→半角・前後空白除去・大文字化（フロントの toHalfWidthAscii + uppercase と同一） */
function normalizeMachineNameForCompare(value: string | null | undefined): string {
  if (value == null) return '';
  const s = String(value).trim();
  const half =
    s.replace(/[\uFF01-\uFF5E]/g, (char) =>
      String.fromCharCode(char.charCodeAt(0) - 0xfee0)
    ).replace(/\u3000/g, ' ');
  return half.toUpperCase();
}

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
  plannedQuantity: number | null;
  plannedStartDate: Date | null;
  plannedEndDate: Date | null;
  resolvedMachineName?: string | null;
  customerName: string | null;
};

export type ProductionScheduleListParams = {
  page: number;
  pageSize: number;
  queryText: string;
  productNos: string[];
  machineName?: string;
  resourceCds: string[];
  assignedOnlyCds: string[];
  resourceCategory?: ProductionScheduleResourceCategory;
  hasNoteOnly: boolean;
  hasDueDateOnly: boolean;
  allowResourceOnly?: boolean;
  locationKey: string;
  siteKey?: string;
  /**
   * `leaderboard`: actual-hours を省略。`resolvedMachineName` は full と同様にバッチ解決する（省略時は full）。
   */
  responseProfile?: 'full' | 'leaderboard';
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
          AND (
            "location" = ${locationKey}
            OR "siteKey" = ${locationKey}
          )
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

const buildProductNoCondition = (productNos: string[]): Prisma.Sql => {
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

const listMatchingFseibansByMachineName = async (normalizedMachineName: string): Promise<string[]> => {
  type MachineRow = { fseiban: string | null; fhinmei: string | null };
  const machineRows = await prisma.$queryRaw<MachineRow[]>`
    SELECT
      "rowData"->>'FSEIBAN' AS "fseiban",
      "rowData"->>'FHINMEI' AS "fhinmei"
    FROM "CsvDashboardRow"
    WHERE "CsvDashboardRow"."csvDashboardId" = ${PRODUCTION_SCHEDULE_DASHBOARD_ID}
      AND ${buildMaxProductNoWinnerCondition('CsvDashboardRow')}
      AND (
        UPPER(COALESCE("CsvDashboardRow"."rowData"->>'FHINCD', '')) LIKE 'MH%'
        OR UPPER(COALESCE("CsvDashboardRow"."rowData"->>'FHINCD', '')) LIKE 'SH%'
      )
  `;
  const supplementRows = await prisma.productionScheduleSeibanMachineNameSupplement.findMany({
    where: {
      sourceCsvDashboardId: PRODUCTION_SCHEDULE_SEIBAN_MACHINE_NAME_SUPPLEMENT_DASHBOARD_ID,
    },
    select: {
      fseiban: true,
      machineName: true,
    },
  });

  return Array.from(
    new Set([
      ...machineRows
        .filter(
          (row) =>
            row.fseiban != null &&
            row.fhinmei != null &&
            normalizeMachineNameForCompare(row.fhinmei) === normalizedMachineName
        )
        .map((row) => row.fseiban as string),
      ...supplementRows
        .filter((row) => normalizeMachineNameForCompare(row.machineName) === normalizedMachineName)
        .map((row) => row.fseiban),
    ])
  );
};

const buildMachineNameCondition = async (machineName: string | undefined): Promise<Prisma.Sql> => {
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
    productNos,
    machineName,
    resourceCds,
    assignedOnlyCds,
    resourceCategory,
    hasNoteOnly,
    hasDueDateOnly,
    allowResourceOnly = false,
    locationKey,
    siteKey,
    responseProfile = 'full'
  } = params;
  const isLeaderboardProfile = responseProfile === 'leaderboard';
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

  // 登録製番なし かつ 割当なし の場合は検索しない。
  // - 資源CD単独（resourceCds）
  // - 工程カテゴリ単独（resourceCategory）
  // - 資源CD + 工程カテゴリ（resourceCds + resourceCategory）
  // はいずれも0件を返す。
  // 割当のみは対象が少ないため単独検索を許可する。
  const hasOnlyResourceFilters =
    textConditions.length === 0 &&
    normalizeMachineNameForCompare(machineName).length === 0 &&
    productNos.length === 0 &&
    filteredAssignedOnlyCds.length === 0 &&
    (filteredResourceCds.length > 0 || resourceCategory !== undefined);

  if (hasOnlyResourceFilters && !allowResourceOnly) {
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
  const queryWhere = Prisma.sql`${buildQueryWhere({
    textConditions,
    resourceConditions,
    resourceCategoryCondition,
    machineNameCondition,
    hasNoteOnly,
    hasDueDateOnly
  })} ${productNoCondition}`;

  const siteScopedGlobalRankLocation = siteKey?.trim().length ? siteKey.trim() : locationKey;

  const offset = (page - 1) * pageSize;

  const countPromise = prisma.$queryRaw<Array<{ total: bigint }>>`
    SELECT COUNT(*)::bigint AS total
    FROM "CsvDashboardRow"
    LEFT JOIN "ProductionScheduleFkojunstStatus" AS "fkst"
      ON "fkst"."csvDashboardRowId" = "CsvDashboardRow"."id"
      AND "fkst"."csvDashboardId" = ${PRODUCTION_SCHEDULE_DASHBOARD_ID}
    LEFT JOIN "ProductionScheduleFkojunstMailStatus" AS "fkmail"
      ON "fkmail"."csvDashboardRowId" = "CsvDashboardRow"."id"
      AND "fkmail"."csvDashboardId" = ${PRODUCTION_SCHEDULE_DASHBOARD_ID}
    WHERE ${baseWhere} ${queryWhere} ${buildFkojunstProductionScheduleListVisibilityWhereSql()}
  `;

  const rowsPromise = prisma.$queryRaw<ProductionScheduleRow[]>`
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
        'FKOJUNST', ( ${buildFkojunstProductionScheduleListRowDataFkojunstSql()} ),
        'progress', (CASE WHEN COALESCE("p"."isCompleted", FALSE) THEN ${COMPLETED_PROGRESS_VALUE} ELSE '' END)
      ) AS "rowData",
      (
        SELECT "orderNumber"
        FROM "ProductionScheduleOrderAssignment"
        WHERE "csvDashboardRowId" = "CsvDashboardRow"."id"
          AND (
            "location" = ${locationKey}
            OR "siteKey" = ${locationKey}
          )
        ORDER BY
          CASE WHEN "location" = ${locationKey} THEN 0 ELSE 1 END ASC,
          "updatedAt" DESC
        LIMIT 1
      ) AS "processingOrder",
      (
        SELECT "globalRank"
        FROM "ProductionScheduleGlobalRowRank"
        WHERE "csvDashboardRowId" = "CsvDashboardRow"."id"
          AND "csvDashboardId" = ${PRODUCTION_SCHEDULE_DASHBOARD_ID}
          AND "location" IN (${siteScopedGlobalRankLocation}, ${GLOBAL_SHARED_LOCATION_KEY}, ${locationKey})
        ORDER BY CASE
          WHEN "location" = ${siteScopedGlobalRankLocation} THEN 0
          WHEN "location" = ${GLOBAL_SHARED_LOCATION_KEY} THEN 1
          ELSE 2
        END ASC
        LIMIT 1
      ) AS "globalRank",
      NULLIF(TRIM("n"."note"), '') AS "note",
      COALESCE("pp"."processingType", "n"."processingType") AS "processingType",
      "n"."dueDate" AS "dueDate",
      "supplement"."plannedQuantity" AS "plannedQuantity",
      "supplement"."plannedStartDate" AS "plannedStartDate",
      "supplement"."plannedEndDate" AS "plannedEndDate"
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
    LEFT JOIN "ProductionScheduleOrderSupplement" AS "supplement"
      ON "supplement"."csvDashboardRowId" = "CsvDashboardRow"."id"
      AND "supplement"."csvDashboardId" = ${PRODUCTION_SCHEDULE_DASHBOARD_ID}
    LEFT JOIN "ProductionScheduleFkojunstStatus" AS "fkst"
      ON "fkst"."csvDashboardRowId" = "CsvDashboardRow"."id"
      AND "fkst"."csvDashboardId" = ${PRODUCTION_SCHEDULE_DASHBOARD_ID}
    LEFT JOIN "ProductionScheduleFkojunstMailStatus" AS "fkmail"
      ON "fkmail"."csvDashboardRowId" = "CsvDashboardRow"."id"
      AND "fkmail"."csvDashboardId" = ${PRODUCTION_SCHEDULE_DASHBOARD_ID}
    WHERE ${baseWhere} ${queryWhere} ${buildFkojunstProductionScheduleListVisibilityWhereSql()}
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

  const [countRows, rows] = await Promise.all([countPromise, rowsPromise]);
  const total = Number(countRows[0]?.total ?? 0n);

  if (isLeaderboardProfile) {
    const lightRows = rows.map((row) => ({
      ...row,
      actualPerPieceMinutes: null as number | null
    }));
    const rowsWithResolvedMachineName = await enrichProductionScheduleRowsWithResolvedMachineName(lightRows);
    const enrichedRows = await enrichProductionScheduleRowsWithCustomerName(rowsWithResolvedMachineName);
    return {
      page,
      pageSize,
      total,
      rows: enrichedRows
    };
  }

  const rowResourceCds = rows
    .map((row) => {
      const rowData = (row.rowData ?? {}) as Record<string, unknown>;
      return typeof rowData.FSIGENCD === 'string' ? rowData.FSIGENCD.trim() : '';
    })
    .filter((resourceCd) => resourceCd.length > 0);
  const actualHoursReadContext = await loadActualHoursReadContext({
    locationKey,
    resourceCds: rowResourceCds
  });

  const rowsWithActualHours = rows.map((row) => {
    const rowData = (row.rowData ?? {}) as Record<string, unknown>;
    const fhincd = typeof rowData.FHINCD === 'string' ? rowData.FHINCD.trim() : '';
    const resourceCd = typeof rowData.FSIGENCD === 'string' ? rowData.FSIGENCD.trim() : '';
    const perPieceMinutes = actualHoursReadContext.resolver.resolve({ fhincd, resourceCd }).perPieceMinutes;
    return {
      ...row,
      actualPerPieceMinutes: perPieceMinutes
    };
  });
  const rowsWithResolvedMachineName = await enrichProductionScheduleRowsWithResolvedMachineName(rowsWithActualHours);
  const enrichedRows = await enrichProductionScheduleRowsWithCustomerName(rowsWithResolvedMachineName);

  return {
    page,
    pageSize,
    total,
    rows: enrichedRows
  };
}

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
    WITH scoped AS (
      SELECT
        "resourceCd",
        "orderNumber"
      FROM "ProductionScheduleOrderAssignment"
      WHERE "csvDashboardId" = ${PRODUCTION_SCHEDULE_DASHBOARD_ID}
        AND (
          "location" = ${locationKey}
          OR "siteKey" = ${locationKey}
        )
        ${
          resourceCds.length > 0
            ? Prisma.sql`AND "resourceCd" IN (${Prisma.join(
                resourceCds.map((cd) => Prisma.sql`${cd}`),
                ','
              )})`
            : Prisma.empty
        }
    )
    SELECT
      "resourceCd" AS "resourceCd",
      array_agg(DISTINCT "orderNumber" ORDER BY "orderNumber") AS "orderNumbers"
    FROM scoped
    GROUP BY "resourceCd"
  `;

  return usageRows.reduce<Record<string, number[]>>((acc, row) => {
    acc[row.resourceCd] = row.orderNumbers ?? [];
    return acc;
  }, {});
}
