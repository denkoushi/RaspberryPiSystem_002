import { prisma } from '../../../lib/prisma.js';
import { PRODUCTION_SCHEDULE_DASHBOARD_ID } from '../constants.js';
import { buildFkojunstProductionScheduleListVisibilityWhereSql } from '../policies/fkojunst-production-schedule-list-visibility.policy.js';
import {
  getResourceCategoryPolicy,
  isProductionScheduleExcludedCuttingResourceCd,
  normalizeProductionScheduleResourceCd,
  type ResourceCategoryPolicy
} from '../policies/resource-category-policy.service.js';
import { buildMaxProductNoWinnerCondition } from '../row-resolver/index.js';
import type { StartDateLevelingQueryRow } from './start-date-leveling.types.js';

type RawRow = {
  rowId: string;
  fseiban: string | null;
  productNo: string | null;
  fhincd: string | null;
  fkojun: string | null;
  resourceCd: string | null;
  perUnitMinutes: number | null;
  plannedQuantity: number | null;
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
      perUnitMinutes: Number(row.perUnitMinutes ?? 0),
      plannedQuantity: row.plannedQuantity == null ? null : Number(row.plannedQuantity),
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
      (
        CASE
          WHEN ("CsvDashboardRow"."rowData"->>'FSIGENSHOYORYO') ~ '^\\s*-?\\d+(\\.\\d+)?\\s*$'
          THEN (("CsvDashboardRow"."rowData"->>'FSIGENSHOYORYO'))::numeric
          ELSE 0
        END
      )::double precision AS "perUnitMinutes",
      "supplement"."plannedQuantity" AS "plannedQuantity",
      "supplement"."plannedStartDate" AS "plannedStartDate",
      COALESCE("n"."dueDate", "supplement"."plannedEndDate") AS "effectiveDueDate"
    FROM "CsvDashboardRow"
    LEFT JOIN "ProductionScheduleFkojunstStatus" AS "fkst"
      ON "fkst"."csvDashboardRowId" = "CsvDashboardRow"."id"
      AND "fkst"."csvDashboardId" = ${PRODUCTION_SCHEDULE_DASHBOARD_ID}
    LEFT JOIN "ProductionScheduleFkojunstMailStatus" AS "fkmail"
      ON "fkmail"."csvDashboardRowId" = "CsvDashboardRow"."id"
      AND "fkmail"."csvDashboardId" = ${PRODUCTION_SCHEDULE_DASHBOARD_ID}
    LEFT JOIN "ProductionScheduleProgress" AS "p"
      ON "p"."csvDashboardRowId" = "CsvDashboardRow"."id"
      AND "p"."csvDashboardId" = ${PRODUCTION_SCHEDULE_DASHBOARD_ID}
    LEFT JOIN "ProductionScheduleRowNote" AS "n"
      ON "n"."csvDashboardRowId" = "CsvDashboardRow"."id"
      AND "n"."csvDashboardId" = ${PRODUCTION_SCHEDULE_DASHBOARD_ID}
    LEFT JOIN "ProductionScheduleOrderSupplement" AS "supplement"
      ON "supplement"."csvDashboardRowId" = "CsvDashboardRow"."id"
      AND "supplement"."csvDashboardId" = ${PRODUCTION_SCHEDULE_DASHBOARD_ID}
    WHERE "CsvDashboardRow"."csvDashboardId" = ${PRODUCTION_SCHEDULE_DASHBOARD_ID}
      AND ${buildMaxProductNoWinnerCondition('CsvDashboardRow')}
      AND COALESCE("p"."isCompleted", FALSE) = FALSE
      AND (
        UPPER(COALESCE("CsvDashboardRow"."rowData"->>'FHINCD', '')) NOT LIKE 'MH%'
        AND UPPER(COALESCE("CsvDashboardRow"."rowData"->>'FHINCD', '')) NOT LIKE 'SH%'
      )
      AND NULLIF(BTRIM("CsvDashboardRow"."rowData"->>'FSIGENCD'), '') IS NOT NULL
      AND (
        (
          "supplement"."plannedStartDate" IS NOT NULL
          AND COALESCE("n"."dueDate", "supplement"."plannedEndDate") IS NOT NULL
          AND "supplement"."plannedStartDate" < ${params.rangeEndExclusive}
          AND COALESCE("n"."dueDate", "supplement"."plannedEndDate") >= ${params.rangeStart}
        )
        OR (
          "supplement"."plannedStartDate" IS NULL
          AND COALESCE("n"."dueDate", "supplement"."plannedEndDate") IS NOT NULL
          AND COALESCE("n"."dueDate", "supplement"."plannedEndDate") >= ${params.rangeStart}
          AND COALESCE("n"."dueDate", "supplement"."plannedEndDate") < ${params.rangeEndExclusive}
        )
        OR (
          "supplement"."plannedStartDate" IS NOT NULL
          AND COALESCE("n"."dueDate", "supplement"."plannedEndDate") IS NULL
          AND "supplement"."plannedStartDate" >= ${params.rangeStart}
          AND "supplement"."plannedStartDate" < ${params.rangeEndExclusive}
        )
      )
      ${buildFkojunstProductionScheduleListVisibilityWhereSql()}
    ORDER BY
      "supplement"."plannedStartDate" ASC,
      COALESCE("n"."dueDate", "supplement"."plannedEndDate") ASC,
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
