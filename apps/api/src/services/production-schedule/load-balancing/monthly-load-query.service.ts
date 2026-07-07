import { Prisma } from '@prisma/client';

import { prisma } from '../../../lib/prisma.js';
import { PRODUCTION_SCHEDULE_DASHBOARD_ID } from '../constants.js';
import { buildCsvDashboardRowRequiredMinutesSql } from './csv-dashboard-row-required-minutes.sql.js';
import { buildLoadBalancingRowEligibilityWhereSql } from './load-balancing-eligibility.policy.js';
import {
  getResourceCategoryPolicy,
  isProductionScheduleExcludedCuttingResourceCd,
  normalizeProductionScheduleResourceCd,
  type ResourceCategoryPolicy
} from '../policies/resource-category-policy.service.js';
import { buildMaterializedMaxProductNoWinnerInCondition } from '../row-resolver/index.js';
import type { LoadBalancingRowCandidate } from './types.js';

export type MonthlyAggregatedLoadRow = {
  resourceCd: string;
  requiredMinutes: number;
};

type RawAggRow = {
  resourceCd: string | null;
  requiredMinutes: number | null;
};

type RawDetailRow = {
  rowId: string;
  fseiban: string | null;
  productNo: string | null;
  fhincd: string | null;
  fhinmei: string | null;
  fkojun: string | null;
  resourceCd: string | null;
  requiredMinutes: number | null;
};

export function parseYearMonthRangeUtc(yearMonth: string): { monthStart: Date; monthEndExclusive: Date } {
  const trimmed = yearMonth.trim();
  const match = /^(\d{4})-(\d{2})$/.exec(trimmed);
  if (!match) {
    throw new Error('month は YYYY-MM 形式で指定してください');
  }
  const y = Number(match[1]);
  const m = Number(match[2]);
  if (m < 1 || m > 12) {
    throw new Error('month は YYYY-MM 形式で指定してください');
  }
  return {
    monthStart: new Date(Date.UTC(y, m - 1, 1)),
    monthEndExclusive: new Date(Date.UTC(y, m, 1))
  };
}

function mergeAggRows(rows: RawAggRow[], policy: ResourceCategoryPolicy): MonthlyAggregatedLoadRow[] {
  const totals = new Map<string, number>();
  for (const row of rows) {
    const normalizedCd = normalizeProductionScheduleResourceCd(String(row.resourceCd ?? ''));
    if (!normalizedCd || isProductionScheduleExcludedCuttingResourceCd(normalizedCd, policy)) continue;
    const required = Number(row.requiredMinutes ?? 0);
    totals.set(normalizedCd, (totals.get(normalizedCd) ?? 0) + required);
  }
  return [...totals.entries()]
    .map(([resourceCd, requiredMinutes]) => ({ resourceCd, requiredMinutes }))
    .sort((a, b) => a.resourceCd.localeCompare(b.resourceCd));
}

export async function aggregateMonthlyLoadByResource(params: {
  siteKey: string;
  deviceScopeKey: string;
  yearMonth: string;
  winnerRowIds: readonly string[];
}): Promise<MonthlyAggregatedLoadRow[]> {
  const policy = await getResourceCategoryPolicy({
    siteKey: params.siteKey,
    deviceScopeKey: params.deviceScopeKey
  });

  const { monthStart, monthEndExclusive } = parseYearMonthRangeUtc(params.yearMonth);

  const rows = await prisma.$queryRaw<RawAggRow[]>`
    SELECT
      UPPER(BTRIM("CsvDashboardRow"."rowData"->>'FSIGENCD')) AS "resourceCd",
      SUM(${buildCsvDashboardRowRequiredMinutesSql()})::double precision AS "requiredMinutes"
    FROM "CsvDashboardRow"
    LEFT JOIN "ProductionScheduleFkojunstMailStatus" AS "fkmail"
      ON "fkmail"."csvDashboardRowId" = "CsvDashboardRow"."id"
      AND "fkmail"."csvDashboardId" = ${PRODUCTION_SCHEDULE_DASHBOARD_ID}
    LEFT JOIN "ProductionScheduleProgress" AS "p"
      ON "p"."csvDashboardRowId" = "CsvDashboardRow"."id"
      AND "p"."csvDashboardId" = ${PRODUCTION_SCHEDULE_DASHBOARD_ID}
    LEFT JOIN "ProductionScheduleExternalCompletion" AS "ext"
      ON "ext"."csvDashboardRowId" = "CsvDashboardRow"."id"
      AND "ext"."csvDashboardId" = ${PRODUCTION_SCHEDULE_DASHBOARD_ID}
    LEFT JOIN "ProductionScheduleOrderSupplement" AS "supplement"
      ON "supplement"."csvDashboardRowId" = "CsvDashboardRow"."id"
      AND "supplement"."csvDashboardId" = ${PRODUCTION_SCHEDULE_DASHBOARD_ID}
    WHERE "CsvDashboardRow"."csvDashboardId" = ${PRODUCTION_SCHEDULE_DASHBOARD_ID}
      AND ${buildMaterializedMaxProductNoWinnerInCondition('CsvDashboardRow', params.winnerRowIds)}
      AND "supplement"."plannedEndDate" IS NOT NULL
      AND "supplement"."plannedEndDate" >= ${monthStart}
      AND "supplement"."plannedEndDate" < ${monthEndExclusive}
      AND (
        UPPER(COALESCE("CsvDashboardRow"."rowData"->>'FHINCD', '')) NOT LIKE 'MH%'
        AND UPPER(COALESCE("CsvDashboardRow"."rowData"->>'FHINCD', '')) NOT LIKE 'SH%'
      )
      AND NULLIF(BTRIM("CsvDashboardRow"."rowData"->>'FSIGENCD'), '') IS NOT NULL
      ${buildLoadBalancingRowEligibilityWhereSql()}
    GROUP BY UPPER(BTRIM("CsvDashboardRow"."rowData"->>'FSIGENCD'))
  `;

  return mergeAggRows(rows, policy);
}

export async function listMonthlyLoadRowCandidates(params: {
  siteKey: string;
  deviceScopeKey: string;
  yearMonth: string;
  includeFhinmei?: boolean;
  winnerRowIds: readonly string[];
}): Promise<LoadBalancingRowCandidate[]> {
  const policy = await getResourceCategoryPolicy({
    siteKey: params.siteKey,
    deviceScopeKey: params.deviceScopeKey
  });

  const { monthStart, monthEndExclusive } = parseYearMonthRangeUtc(params.yearMonth);
  const includeFhinmei = params.includeFhinmei ?? true;

  const rows = await prisma.$queryRaw<RawDetailRow[]>`
    SELECT
      "CsvDashboardRow"."id" AS "rowId",
      COALESCE(("CsvDashboardRow"."rowData"->>'FSEIBAN'), '') AS "fseiban",
      COALESCE(("CsvDashboardRow"."rowData"->>'ProductNo'), '') AS "productNo",
      COALESCE(("CsvDashboardRow"."rowData"->>'FHINCD'), '') AS "fhincd",
      ${includeFhinmei ? Prisma.sql`COALESCE(("CsvDashboardRow"."rowData"->>'FHINMEI'), '')` : Prisma.sql`''`} AS "fhinmei",
      COALESCE(("CsvDashboardRow"."rowData"->>'FKOJUN'), '') AS "fkojun",
      UPPER(BTRIM("CsvDashboardRow"."rowData"->>'FSIGENCD')) AS "resourceCd",
      ${buildCsvDashboardRowRequiredMinutesSql()} AS "requiredMinutes"
    FROM "CsvDashboardRow"
    LEFT JOIN "ProductionScheduleFkojunstMailStatus" AS "fkmail"
      ON "fkmail"."csvDashboardRowId" = "CsvDashboardRow"."id"
      AND "fkmail"."csvDashboardId" = ${PRODUCTION_SCHEDULE_DASHBOARD_ID}
    LEFT JOIN "ProductionScheduleProgress" AS "p"
      ON "p"."csvDashboardRowId" = "CsvDashboardRow"."id"
      AND "p"."csvDashboardId" = ${PRODUCTION_SCHEDULE_DASHBOARD_ID}
    LEFT JOIN "ProductionScheduleExternalCompletion" AS "ext"
      ON "ext"."csvDashboardRowId" = "CsvDashboardRow"."id"
      AND "ext"."csvDashboardId" = ${PRODUCTION_SCHEDULE_DASHBOARD_ID}
    LEFT JOIN "ProductionScheduleOrderSupplement" AS "supplement"
      ON "supplement"."csvDashboardRowId" = "CsvDashboardRow"."id"
      AND "supplement"."csvDashboardId" = ${PRODUCTION_SCHEDULE_DASHBOARD_ID}
    WHERE "CsvDashboardRow"."csvDashboardId" = ${PRODUCTION_SCHEDULE_DASHBOARD_ID}
      AND ${buildMaterializedMaxProductNoWinnerInCondition('CsvDashboardRow', params.winnerRowIds)}
      AND "supplement"."plannedEndDate" IS NOT NULL
      AND "supplement"."plannedEndDate" >= ${monthStart}
      AND "supplement"."plannedEndDate" < ${monthEndExclusive}
      AND (
        UPPER(COALESCE("CsvDashboardRow"."rowData"->>'FHINCD', '')) NOT LIKE 'MH%'
        AND UPPER(COALESCE("CsvDashboardRow"."rowData"->>'FHINCD', '')) NOT LIKE 'SH%'
      )
      AND NULLIF(BTRIM("CsvDashboardRow"."rowData"->>'FSIGENCD'), '') IS NOT NULL
      ${buildLoadBalancingRowEligibilityWhereSql()}
    ORDER BY
      ("CsvDashboardRow"."rowData"->>'FSEIBAN') ASC,
      ("CsvDashboardRow"."rowData"->>'ProductNo') ASC,
      (CASE
        WHEN ("CsvDashboardRow"."rowData"->>'FKOJUN') ~ '^\\d+$' THEN (("CsvDashboardRow"."rowData"->>'FKOJUN'))::int
        ELSE NULL
      END) ASC
  `;

  const result: LoadBalancingRowCandidate[] = [];
  for (const row of rows) {
    const normalizedCd = normalizeProductionScheduleResourceCd(String(row.resourceCd ?? ''));
    if (!normalizedCd || isProductionScheduleExcludedCuttingResourceCd(normalizedCd, policy)) continue;
    const requiredMinutes = Number(row.requiredMinutes ?? 0);
    if (requiredMinutes <= 0) continue;
    const fkojunRaw = String(row.fkojun ?? '').trim();
    result.push({
      rowId: row.rowId,
      fseiban: String(row.fseiban ?? '').trim(),
      productNo: String(row.productNo ?? '').trim(),
      fhincd: String(row.fhincd ?? '').trim(),
      fhinmei: String(row.fhinmei ?? '').trim(),
      fkojun: fkojunRaw.length > 0 ? fkojunRaw : null,
      resourceCd: normalizedCd,
      requiredMinutes
    });
  }

  return result;
}