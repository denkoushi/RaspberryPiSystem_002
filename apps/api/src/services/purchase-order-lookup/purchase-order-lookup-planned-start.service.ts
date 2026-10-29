import { Prisma } from '@prisma/client';

import { prisma } from '../../lib/prisma.js';
import { normalizePartName } from '../../lib/part-name-normalize.js';
import {
  normalizePurchaseFhinCdForMatching,
  normalizePurchaseFhinCdForScheduleLookup,
} from './purchase-fhincd-normalize.js';
import { PRODUCTION_SCHEDULE_DASHBOARD_ID } from '../production-schedule/constants.js';
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
};

function lookupKey(seiban: string, part: string): string {
  return `${seiban.trim()}\t${part.trim()}`;
}

/** Fetch winners once per order; resolve earliest dates in match-key → code → name order. */
export async function findEarliestPlannedStartDatesForPurchaseRows(
  purchaseRows: PurchasePart[]
): Promise<Array<Date | null>> {
  // Preserve known raw variants without wrapping the indexed FSEIBAN expression in trim().
  const seibans = [...new Set(purchaseRows.flatMap(({ seiban }) =>
    seiban.trim() ? [seiban.trim(), seiban] : []
  ))];
  if (seibans.length === 0) return purchaseRows.map(() => null);

  const rows = await listPurchasePlannedStartCandidates(seibans);

  const byMatchKey = new Map<string, Date>();
  const byNormalizedCode = new Map<string, Date>();
  const byPartName = new Map<string, Date>();
  const keepEarliest = (map: Map<string, Date>, seiban: string, part: string, date: Date) => {
    if (!seiban.trim() || !part.trim()) return;
    const key = lookupKey(seiban, part);
    const previous = map.get(key);
    if (!previous || date < previous) map.set(key, date);
  };
  for (const row of rows) {
    if (row.plannedStartDate === null) continue;
    keepEarliest(byMatchKey, row.seiban, normalizePurchaseFhinCdForMatching(row.fhincd), row.plannedStartDate);
    keepEarliest(byNormalizedCode, row.seiban, normalizePurchaseFhinCdForScheduleLookup(row.fhincd), row.plannedStartDate);
    keepEarliest(byPartName, row.seiban, normalizePartName(row.fhinmei), row.plannedStartDate);
  }

  return purchaseRows.map((row) =>
    byMatchKey.get(lookupKey(row.seiban, row.purchasePartCodeMatchKey)) ??
    byNormalizedCode.get(lookupKey(row.seiban, row.purchasePartCodeNormalized)) ??
    byPartName.get(lookupKey(row.seiban, normalizePartName(row.purchasePartName))) ??
    null
  );
}

/** Full schedule-derived candidates for independent mobile display data. */
export async function listPurchasePlannedStartCandidates(seibans?: string[]): Promise<ScheduleCandidate[]> {
  return await prisma.$queryRaw<ScheduleCandidate[]>`
    SELECT
      COALESCE(r."rowData"->>'FSEIBAN', '') AS seiban,
      COALESCE(r."rowData"->>'FHINCD', '') AS fhincd,
      COALESCE(r."rowData"->>'FHINMEI', '') AS fhinmei,
      s."plannedStartDate"
    FROM "CsvDashboardRow" r
    INNER JOIN "ProductionScheduleOrderSupplement" s ON s."csvDashboardRowId" = r.id
    WHERE r."csvDashboardId" = ${PRODUCTION_SCHEDULE_DASHBOARD_ID}
      AND s."csvDashboardId" = ${PRODUCTION_SCHEDULE_DASHBOARD_ID}
      ${seibans ? Prisma.sql`AND COALESCE(r."rowData"->>'FSEIBAN', '') = ANY(${seibans}::text[])` : Prisma.empty}
      AND ${buildMaxProductNoWinnerCondition('r')}
  `;
}
