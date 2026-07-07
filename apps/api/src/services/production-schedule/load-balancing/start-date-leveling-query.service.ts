import { prisma } from '../../../lib/prisma.js';
import { PRODUCTION_SCHEDULE_DASHBOARD_ID } from '../constants.js';
import {
  getResourceCategoryPolicy,
  isProductionScheduleExcludedCuttingResourceCd,
  normalizeProductionScheduleResourceCd,
  type ResourceCategoryPolicy
} from '../policies/resource-category-policy.service.js';
import { buildMaterializedMaxProductNoWinnerInCondition } from '../row-resolver/index.js';
import { buildCsvDashboardRowRequiredMinutesSql } from './csv-dashboard-row-required-minutes.sql.js';
import { buildLoadBalancingRowEligibilityWhereSql } from './load-balancing-eligibility.policy.js';
import { buildStartDateLevelingQueryWindowWhereSql } from './start-date-leveling-query-window.policy.js';
import type { StartDateLevelingQueryRow } from './start-date-leveling.types.js';

type RawRow = {
  rowId: string;
  fseiban: string | null;
  productNo: string | null;
  fhincd: string | null;
  fkojun: string | null;
  resourceCd: string | null;
  requiredMinutes: number | null;
  plannedStartDate: Date | null;
  effectiveDueDate: Date | null;
};

function mapRawRows(rows: RawRow[], policy: ResourceCategoryPolicy): StartDateLevelingQueryRow[] {
  const result: StartDateLevelingQueryRow[] = [];
  for (const row of rows) {
    const normalizedCd = normalizeProductionScheduleResourceCd(String(row.resourceCd ?? ''));
    if (!normalizedCd || isProductionScheduleExcludedCuttingResourceCd(normalizedCd, policy)) {
      continue;
    }
    const fkojunRaw = String(row.fkojun ?? '').trim();
    result.push({
      rowId: row.rowId,
      fseiban: String(row.fseiban ?? '').trim(),
      productNo: String(row.productNo ?? '').trim(),
      fhincd: String(row.fhincd ?? '').trim(),
      fkojun: fkojunRaw.length > 0 ? fkojunRaw : null,
      resourceCd: normalizedCd,
      requiredMinutes: Number(row.requiredMinutes ?? 0),
      plannedStartDate: row.plannedStartDate,
      effectiveDueDate: row.effectiveDueDate
    });
  }
  return result;
}

export async function listStartDateLevelingQueryRows(params: {
  siteKey: string;
  deviceScopeKey: string;
  rangeStart: Date;
  rangeEndExclusive: Date;
  resourceCdFilter?: string | null;
  winnerRowIds: readonly string[];
}): Promise<StartDateLevelingQueryRow[]> {
  const policy = await getResourceCategoryPolicy({
    siteKey: params.siteKey,
    deviceScopeKey: params.deviceScopeKey
  });

  const rows = await prisma.$queryRaw<RawRow[]>`
    SELECT
      "CsvDashboardRow"."id" AS "rowId",
      COALESCE(("CsvDashboardRow"."rowData"->>'FSEIBAN'), '') AS "fseiban",
      COALESCE(("CsvDashboardRow"."rowData"->>'ProductNo'), '') AS "productNo",
      COALESCE(("CsvDashboardRow"."rowData"->>'FHINCD'), '') AS "fhincd",
      COALESCE(("CsvDashboardRow"."rowData"->>'FKOJUN'), '') AS "fkojun",
      UPPER(BTRIM("CsvDashboardRow"."rowData"->>'FSIGENCD')) AS "resourceCd",
      ${buildCsvDashboardRowRequiredMinutesSql()} AS "requiredMinutes",
      "supplement"."plannedStartDate" AS "plannedStartDate",
      COALESCE("n"."dueDate", "supplement"."plannedEndDate") AS "effectiveDueDate"
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
    LEFT JOIN "ProductionScheduleRowNote" AS "n"
      ON "n"."csvDashboardRowId" = "CsvDashboardRow"."id"
      AND "n"."csvDashboardId" = ${PRODUCTION_SCHEDULE_DASHBOARD_ID}
    LEFT JOIN "ProductionScheduleOrderSupplement" AS "supplement"
      ON "supplement"."csvDashboardRowId" = "CsvDashboardRow"."id"
      AND "supplement"."csvDashboardId" = ${PRODUCTION_SCHEDULE_DASHBOARD_ID}
    WHERE "CsvDashboardRow"."csvDashboardId" = ${PRODUCTION_SCHEDULE_DASHBOARD_ID}
      AND ${buildMaterializedMaxProductNoWinnerInCondition('CsvDashboardRow', params.winnerRowIds)}
      AND (
        UPPER(COALESCE("CsvDashboardRow"."rowData"->>'FHINCD', '')) NOT LIKE 'MH%'
        AND UPPER(COALESCE("CsvDashboardRow"."rowData"->>'FHINCD', '')) NOT LIKE 'SH%'
      )
      AND NULLIF(BTRIM("CsvDashboardRow"."rowData"->>'FSIGENCD'), '') IS NOT NULL
      ${buildStartDateLevelingQueryWindowWhereSql({
        rangeStart: params.rangeStart,
        rangeEndExclusive: params.rangeEndExclusive
      })}
      ${buildLoadBalancingRowEligibilityWhereSql()}
    ORDER BY
      "supplement"."plannedStartDate" ASC NULLS LAST,
      COALESCE("n"."dueDate", "supplement"."plannedEndDate") ASC NULLS LAST,
      ("CsvDashboardRow"."rowData"->>'FSEIBAN') ASC,
      ("CsvDashboardRow"."rowData"->>'FHINCD') ASC
  `;

  const mapped = mapRawRows(rows, policy);
  const resourceFilter = params.resourceCdFilter?.trim().toUpperCase() ?? '';
  if (resourceFilter.length === 0) {
    return mapped;
  }
  return mapped.filter((row) => row.resourceCd === resourceFilter);
}
