import { Prisma } from '@prisma/client';

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
import { formatYearMonthFromUtcDate } from './year-month-range.js';

export type MachineMonthlyLoadFseibanAggregate = {
  fseiban: string;
  requiredMinutes: number;
};

type RawFseibanAggRow = {
  fseiban: string | null;
  resourceCd: string | null;
  requiredMinutes: number | null;
};

export type MachineMonthlyLoadQueryRow = {
  rowId: string;
  fseiban: string;
  productNo: string;
  fhincd: string;
  fhinmei: string;
  fkojun: string | null;
  resourceCd: string;
  requiredMinutes: number;
  effectiveDueDate: Date;
  noteDueDate: Date | null;
  plannedEndDate: Date | null;
};

type RawRow = {
  rowId: string;
  fseiban: string | null;
  productNo: string | null;
  fhincd: string | null;
  fhinmei: string | null;
  fkojun: string | null;
  resourceCd: string | null;
  requiredMinutes: number | null;
  effectiveDueDate: Date | null;
  noteDueDate: Date | null;
  plannedEndDate: Date | null;
};

function mapRawRows(rows: RawRow[], policy: ResourceCategoryPolicy): MachineMonthlyLoadQueryRow[] {
  const result: MachineMonthlyLoadQueryRow[] = [];
  for (const row of rows) {
    const normalizedCd = normalizeProductionScheduleResourceCd(String(row.resourceCd ?? ''));
    if (!normalizedCd || isProductionScheduleExcludedCuttingResourceCd(normalizedCd, policy)) {
      continue;
    }
    const requiredMinutes = Number(row.requiredMinutes ?? 0);
    if (requiredMinutes <= 0) continue;
    const effectiveDueDate = row.effectiveDueDate;
    if (!effectiveDueDate) continue;

    const fkojunRaw = String(row.fkojun ?? '').trim();
    result.push({
      rowId: row.rowId,
      fseiban: String(row.fseiban ?? '').trim(),
      productNo: String(row.productNo ?? '').trim(),
      fhincd: String(row.fhincd ?? '').trim(),
      fhinmei: String(row.fhinmei ?? '').trim(),
      fkojun: fkojunRaw.length > 0 ? fkojunRaw : null,
      resourceCd: normalizedCd,
      requiredMinutes,
      effectiveDueDate,
      noteDueDate: row.noteDueDate,
      plannedEndDate: row.plannedEndDate
    });
  }
  return result;
}

function mergeFseibanAggRows(
  rows: RawFseibanAggRow[],
  policy: ResourceCategoryPolicy
): MachineMonthlyLoadFseibanAggregate[] {
  const totals = new Map<string, number>();
  for (const row of rows) {
    const normalizedCd = normalizeProductionScheduleResourceCd(String(row.resourceCd ?? ''));
    if (!normalizedCd || isProductionScheduleExcludedCuttingResourceCd(normalizedCd, policy)) {
      continue;
    }
    const requiredMinutes = Number(row.requiredMinutes ?? 0);
    if (requiredMinutes <= 0) continue;
    const fseiban = String(row.fseiban ?? '').trim();
    totals.set(fseiban, (totals.get(fseiban) ?? 0) + requiredMinutes);
  }
  return [...totals.entries()]
    .map(([fseiban, requiredMinutes]) => ({ fseiban, requiredMinutes }))
    .sort((a, b) => b.requiredMinutes - a.requiredMinutes || a.fseiban.localeCompare(b.fseiban));
}

function buildMachineMonthlyLoadFseibanFilterSql(fseibans: string[] | undefined): Prisma.Sql {
  if (!fseibans) {
    return Prisma.empty;
  }
  if (fseibans.length === 0) {
    return Prisma.sql`AND FALSE`;
  }
  return Prisma.sql`AND COALESCE(("CsvDashboardRow"."rowData"->>'FSEIBAN'), '') IN (${Prisma.join(fseibans)})`;
}

function buildMachineMonthlyLoadFhincdFilterSql(fhincd: string | undefined): Prisma.Sql {
  const trimmed = fhincd?.trim();
  if (!trimmed) {
    return Prisma.empty;
  }
  return Prisma.sql`AND UPPER(COALESCE("CsvDashboardRow"."rowData"->>'FHINCD', '')) = ${trimmed.toUpperCase()}`;
}

export async function aggregateMachineMonthlyLoadByFseiban(params: {
  siteKey: string;
  deviceScopeKey: string;
  rangeStart: Date;
  rangeEndExclusive: Date;
  winnerRowIds: readonly string[];
}): Promise<MachineMonthlyLoadFseibanAggregate[]> {
  const policy = await getResourceCategoryPolicy({
    siteKey: params.siteKey,
    deviceScopeKey: params.deviceScopeKey
  });

  const rows = await prisma.$queryRaw<RawFseibanAggRow[]>`
    SELECT
      COALESCE(("CsvDashboardRow"."rowData"->>'FSEIBAN'), '') AS "fseiban",
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
    LEFT JOIN "ProductionScheduleRowNote" AS "n"
      ON "n"."csvDashboardRowId" = "CsvDashboardRow"."id"
      AND "n"."csvDashboardId" = ${PRODUCTION_SCHEDULE_DASHBOARD_ID}
    LEFT JOIN "ProductionScheduleOrderSupplement" AS "supplement"
      ON "supplement"."csvDashboardRowId" = "CsvDashboardRow"."id"
      AND "supplement"."csvDashboardId" = ${PRODUCTION_SCHEDULE_DASHBOARD_ID}
    WHERE "CsvDashboardRow"."csvDashboardId" = ${PRODUCTION_SCHEDULE_DASHBOARD_ID}
      AND ${buildMaterializedMaxProductNoWinnerInCondition('CsvDashboardRow', params.winnerRowIds)}
      AND COALESCE("n"."dueDate", "supplement"."plannedEndDate") IS NOT NULL
      AND COALESCE("n"."dueDate", "supplement"."plannedEndDate") >= ${params.rangeStart}
      AND COALESCE("n"."dueDate", "supplement"."plannedEndDate") < ${params.rangeEndExclusive}
      AND (
        UPPER(COALESCE("CsvDashboardRow"."rowData"->>'FHINCD', '')) NOT LIKE 'MH%'
        AND UPPER(COALESCE("CsvDashboardRow"."rowData"->>'FHINCD', '')) NOT LIKE 'SH%'
      )
      AND NULLIF(BTRIM("CsvDashboardRow"."rowData"->>'FSIGENCD'), '') IS NOT NULL
      ${buildLoadBalancingRowEligibilityWhereSql()}
    GROUP BY
      COALESCE(("CsvDashboardRow"."rowData"->>'FSEIBAN'), ''),
      UPPER(BTRIM("CsvDashboardRow"."rowData"->>'FSIGENCD'))
  `;

  return mergeFseibanAggRows(rows, policy);
}

export async function listMachineMonthlyLoadQueryRows(params: {
  siteKey: string;
  deviceScopeKey: string;
  rangeStart: Date;
  rangeEndExclusive: Date;
  fseibans?: string[];
  fhincd?: string | null;
  winnerRowIds: readonly string[];
}): Promise<MachineMonthlyLoadQueryRow[]> {
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
      COALESCE(("CsvDashboardRow"."rowData"->>'FHINMEI'), '') AS "fhinmei",
      COALESCE(("CsvDashboardRow"."rowData"->>'FKOJUN'), '') AS "fkojun",
      UPPER(BTRIM("CsvDashboardRow"."rowData"->>'FSIGENCD')) AS "resourceCd",
      ${buildCsvDashboardRowRequiredMinutesSql()} AS "requiredMinutes",
      COALESCE("n"."dueDate", "supplement"."plannedEndDate") AS "effectiveDueDate",
      "n"."dueDate" AS "noteDueDate",
      "supplement"."plannedEndDate" AS "plannedEndDate"
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
      AND COALESCE("n"."dueDate", "supplement"."plannedEndDate") IS NOT NULL
      AND COALESCE("n"."dueDate", "supplement"."plannedEndDate") >= ${params.rangeStart}
      AND COALESCE("n"."dueDate", "supplement"."plannedEndDate") < ${params.rangeEndExclusive}
      AND (
        UPPER(COALESCE("CsvDashboardRow"."rowData"->>'FHINCD', '')) NOT LIKE 'MH%'
        AND UPPER(COALESCE("CsvDashboardRow"."rowData"->>'FHINCD', '')) NOT LIKE 'SH%'
      )
      AND NULLIF(BTRIM("CsvDashboardRow"."rowData"->>'FSIGENCD'), '') IS NOT NULL
      ${buildLoadBalancingRowEligibilityWhereSql()}
      ${buildMachineMonthlyLoadFseibanFilterSql(params.fseibans)}
      ${buildMachineMonthlyLoadFhincdFilterSql(params.fhincd ?? undefined)}
    ORDER BY
      COALESCE("n"."dueDate", "supplement"."plannedEndDate") ASC,
      ("CsvDashboardRow"."rowData"->>'FSEIBAN') ASC,
      ("CsvDashboardRow"."rowData"->>'FHINCD') ASC
  `;

  return mapRawRows(rows, policy);
}

export function toEffectiveDueDateSource(row: MachineMonthlyLoadQueryRow): 'manual' | 'csv' {
  if (row.noteDueDate != null) {
    return 'manual';
  }
  return 'csv';
}

export function toYearMonthKey(row: MachineMonthlyLoadQueryRow): string {
  return formatYearMonthFromUtcDate(row.effectiveDueDate);
}
