import { prisma } from '../../lib/prisma.js';
import { normalizePartName } from '../../lib/part-name-normalize.js';
import {
  normalizePurchaseFhinCdForMatching,
  normalizePurchaseFhinCdForScheduleLookup,
} from './purchase-fhincd-normalize.js';
import { PRODUCTION_SCHEDULE_DASHBOARD_ID } from '../production-schedule/constants.js';
import { buildProductionScheduleEffectiveCompletedSql } from '../production-schedule/production-schedule-effective-completion.sql.js';
import { buildMaxProductNoWinnerCondition } from '../production-schedule/row-resolver/index.js';

type PurchasePart = {
  seiban: string;
  purchasePartCodeMatchKey: string;
  purchasePartCodeNormalized: string;
  purchasePartName: string;
};

type ScheduleCandidate = {
  seiban: string;
  fhincd: string;
  fhinmei: string;
  plannedStartDate: Date | null;
  productNo: string;
  completed: boolean;
};

function lookupKey(seiban: string, part: string): string {
  return `${seiban.trim()}\t${part.trim()}`;
}

/**
 * Fetch winners once; per map key, use the latest numeric manufacturing order with a date.
 * Prefer its earliest incomplete process, falling back to its earliest date if all are complete.
 * Resolve results in match-key → code → name order.
 */
export async function findEarliestPlannedStartDatesForPurchaseRows(
  purchaseRows: PurchasePart[]
): Promise<Array<Date | null>> {
  // Preserve known raw variants without wrapping the indexed FSEIBAN expression in trim().
  const seibans = [...new Set(purchaseRows.flatMap(({ seiban }) =>
    seiban.trim() ? [seiban.trim(), seiban] : []
  ))];
  if (seibans.length === 0) return purchaseRows.map(() => null);

  const rows = await prisma.$queryRaw<ScheduleCandidate[]>`
    SELECT
      COALESCE(r."rowData"->>'FSEIBAN', '') AS seiban,
      COALESCE(r."rowData"->>'FHINCD', '') AS fhincd,
      COALESCE(r."rowData"->>'FHINMEI', '') AS fhinmei,
      s."plannedStartDate",
      (CASE WHEN (r."rowData"->>'ProductNo') ~ '^[0-9]+$'
        THEN (r."rowData"->>'ProductNo')::bigint ELSE -1 END)::text AS "productNo",
      ${buildProductionScheduleEffectiveCompletedSql()} AS completed
    FROM "CsvDashboardRow" r
    INNER JOIN "ProductionScheduleOrderSupplement" s ON s."csvDashboardRowId" = r.id
    LEFT JOIN "ProductionScheduleProgress" AS "p"
      ON "p"."csvDashboardRowId" = r.id AND "p"."csvDashboardId" = r."csvDashboardId"
    LEFT JOIN "ProductionScheduleExternalCompletion" AS "ext"
      ON "ext"."csvDashboardRowId" = r.id AND "ext"."csvDashboardId" = r."csvDashboardId"
    WHERE r."csvDashboardId" = ${PRODUCTION_SCHEDULE_DASHBOARD_ID}
      AND s."csvDashboardId" = ${PRODUCTION_SCHEDULE_DASHBOARD_ID}
      AND COALESCE(r."rowData"->>'FSEIBAN', '') = ANY(${seibans}::text[])
      AND ${buildMaxProductNoWinnerCondition('r')}
  `;

  type SelectedDate = { productNo: bigint; completed: boolean; date: Date };
  const byMatchKey = new Map<string, SelectedDate>();
  const byNormalizedCode = new Map<string, SelectedDate>();
  const byPartName = new Map<string, SelectedDate>();
  const keepPreferred = (map: Map<string, SelectedDate>, seiban: string, part: string, candidate: SelectedDate) => {
    if (!seiban.trim() || !part.trim()) return;
    const key = lookupKey(seiban, part);
    const previous = map.get(key);
    if (!previous || candidate.productNo > previous.productNo ||
      (candidate.productNo === previous.productNo &&
        ((previous.completed && !candidate.completed) ||
          (candidate.completed === previous.completed && candidate.date < previous.date)))) {
      map.set(key, candidate);
    }
  };
  for (const row of rows) {
    if (row.plannedStartDate === null) continue;
    const candidate = { productNo: BigInt(row.productNo), completed: row.completed, date: row.plannedStartDate };
    keepPreferred(byMatchKey, row.seiban, normalizePurchaseFhinCdForMatching(row.fhincd), candidate);
    keepPreferred(byNormalizedCode, row.seiban, normalizePurchaseFhinCdForScheduleLookup(row.fhincd), candidate);
    keepPreferred(byPartName, row.seiban, normalizePartName(row.fhinmei), candidate);
  }

  return purchaseRows.map((row) =>
    byMatchKey.get(lookupKey(row.seiban, row.purchasePartCodeMatchKey))?.date ??
    byNormalizedCode.get(lookupKey(row.seiban, row.purchasePartCodeNormalized))?.date ??
    byPartName.get(lookupKey(row.seiban, normalizePartName(row.purchasePartName)))?.date ??
    null
  );
}
