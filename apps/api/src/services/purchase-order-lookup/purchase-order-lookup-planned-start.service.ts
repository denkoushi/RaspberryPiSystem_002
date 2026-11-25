import { isPreferredPurchaseDateCandidate } from '@raspi-system/slip-match-core';
import { Prisma } from '@prisma/client';

import { prisma } from '../../lib/prisma.js';
import { normalizePartName } from '../../lib/part-name-normalize.js';
import {
  normalizePurchaseFhinCdForMatching,
  normalizePurchaseFhinCdForScheduleLookup,
} from './purchase-fhincd-normalize.js';
import { PRODUCTION_SCHEDULE_DASHBOARD_ID } from '../production-schedule/constants.js';
import { buildProductionScheduleEffectiveCompletedSql } from '../production-schedule/production-schedule-effective-completion.sql.js';
import { buildMaxProductNoWinnerCondition } from '../production-schedule/row-resolver/index.js';

export type PurchasePart = {
  seiban: string;
  purchasePartCodeMatchKey: string;
  purchasePartCodeNormalized: string;
  purchasePartName: string;
};

export type ScheduleCandidate = {
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
 * Fetch every live (not superseded) row once; per map key, take the earliest incomplete process
 * across all manufacturing orders, falling back to the earliest date if all are complete.
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

  const rows = await listPurchasePlannedStartCandidates(seibans);

  return resolvePurchasePlannedStartCandidates(purchaseRows, rows).map((candidate) => candidate?.date ?? null);
}

export type SelectedPurchaseCandidate = { productNo: bigint; completed: boolean; date: Date };

function isPreferredPurchaseCandidate(candidate: SelectedPurchaseCandidate, previous: SelectedPurchaseCandidate): boolean {
  return isPreferredPurchaseDateCandidate(
    { ...candidate, date: candidate.date.getTime() },
    { ...previous, date: previous.date.getTime() }
  );
}

/** Shared selection for purchase lookup dates and current-placement completion. */
export function resolvePurchasePlannedStartCandidates(
  purchaseRows: PurchasePart[],
  rows: ScheduleCandidate[]
): Array<SelectedPurchaseCandidate | null> {
  const byMatchKey = new Map<string, SelectedPurchaseCandidate>();
  const byNormalizedCode = new Map<string, SelectedPurchaseCandidate>();
  const byPartName = new Map<string, SelectedPurchaseCandidate>();
  // 購買票には製造オーダー番号が無い。同じ製番+部品に生きている番号が複数あるときは、
  // 未完了の工程を優先し、その中で最も早い日付を採る(番号が大きいほうだけを見ない)。
  // 完全に同じ日付なら番号が大きいほうで決める。
  const keepPreferred = (map: Map<string, SelectedPurchaseCandidate>, seiban: string, part: string, candidate: SelectedPurchaseCandidate) => {
    if (!seiban.trim() || !part.trim()) return;
    const key = lookupKey(seiban, part);
    const previous = map.get(key);
    if (!previous || isPreferredPurchaseCandidate(candidate, previous)) map.set(key, candidate);
  };
  for (const row of rows) {
    if (row.plannedStartDate === null) continue;
    const candidate = { productNo: BigInt(row.productNo), completed: row.completed, date: row.plannedStartDate };
    keepPreferred(byMatchKey, row.seiban, normalizePurchaseFhinCdForMatching(row.fhincd), candidate);
    keepPreferred(byNormalizedCode, row.seiban, normalizePurchaseFhinCdForScheduleLookup(row.fhincd), candidate);
    keepPreferred(byPartName, row.seiban, normalizePartName(row.fhinmei), candidate);
  }

  return purchaseRows.map((row) =>
    byMatchKey.get(lookupKey(row.seiban, row.purchasePartCodeMatchKey)) ??
    byNormalizedCode.get(lookupKey(row.seiban, row.purchasePartCodeNormalized)) ??
    byPartName.get(lookupKey(row.seiban, normalizePartName(row.purchasePartName))) ??
    null
  );
}

/** Full schedule-derived candidates for independent mobile display data. */
export async function listPurchasePlannedStartCandidates(seibans?: string[], db: Pick<Prisma.TransactionClient, '$queryRaw'> = prisma): Promise<ScheduleCandidate[]> {
  return await db.$queryRaw<ScheduleCandidate[]>`
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
      ${seibans ? Prisma.sql`AND COALESCE(r."rowData"->>'FSEIBAN', '') = ANY(${seibans}::text[])` : Prisma.empty}
      AND ${buildMaxProductNoWinnerCondition('r')}
  `;
}
