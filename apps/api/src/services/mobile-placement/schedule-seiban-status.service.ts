import { Prisma } from '@prisma/client';

import { prisma } from '../../lib/prisma.js';
import { PRODUCTION_SCHEDULE_DASHBOARD_ID } from '../production-schedule/constants.js';
import { buildProductionScheduleEffectiveCompletedSql } from '../production-schedule/production-schedule-effective-completion.sql.js';
import { buildMaxProductNoWinnerCondition } from '../production-schedule/row-resolver/index.js';
import { resolveSeibanMachineDisplayNamesBatched } from '../production-schedule/seiban-machine-display-names.service.js';
import { isMissingSeibanMachineName } from '../production-schedule/seiban-machine-name-state.js';
import { normalizePurchaseFhinCdForMatching } from '../purchase-order-lookup/purchase-fhincd-normalize.js';

import { normalizeSlipToken } from './mobile-placement-slip-match.js';
import { readScheduleDates } from './schedule-dates.js';

export type SchedulePartState = 'done' | 'shelf' | 'verified' | 'pending';
export type ScheduleSeibanPart = {
  productNo: string; fhincd: string; fhinmei: string; state: SchedulePartState;
  shelfCodeRaw?: string; shelfLabel?: string;
};
export type ScheduleSeibanSummary = {
  fseiban: string; aliasFseibans: string[]; partsCompleteDate: string | null; sendOutDate: string | null;
  outsourceMarks: string[]; memo: string | null; machineName: string | null;
  counts: Record<SchedulePartState, number>;
};
export type ScheduleSeibanDetail = ScheduleSeibanSummary & { parts: ScheduleSeibanPart[] };
const LIST_LIMIT = 200;
type PartRow = { fseiban: string; productNo: string; fhincd: string | null; fhinmei: string | null; completed: boolean };
type PlacementRow = { manufacturingOrderBarcodeRaw: string; shelfCodeRaw: string; slipKind: string; scheduleSnapshot: unknown; updatedAt: Date };

function textField(value: unknown, key: string): string {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return '';
  const field = (value as Record<string, unknown>)[key];
  return typeof field === 'string' ? field : '';
}

// The SQL expression only narrows each batch; shared JS normalization is authoritative below.
function tokenSql(column: Prisma.Sql): Prisma.Sql {
  return Prisma.sql`btrim(replace(${column}, chr(12288), ' '), E' \\t\\n\\r\\f\\013')`;
}

/** One batch per source, shared by list/detail; imported Excel rows are the only entry point. */
async function aggregateScheduleSeibans(requestedFseiban?: string): Promise<ScheduleSeibanDetail[]> {
  const schedules = await prisma.productionScheduleDScheduleMinutes.findMany({
    where: { csvDashboardId: PRODUCTION_SCHEDULE_DASHBOARD_ID },
    orderBy: [{ partsCompleteDate: { sort: 'asc', nulls: 'last' } }, { fseiban: 'asc' }],
    select: { fseiban: true, isAlias: true, aliasOf: true, partsCompleteDate: true, surfaceSendOutDates: true, outsourceMarks: true, memo: true }
  });
  const roots = schedules.filter(row => !row.isAlias && (!requestedFseiban || row.fseiban === requestedFseiban));
  if (!roots.length) return [];
  const aliases = new Map(roots.map(row => [row.fseiban, schedules.filter(alias => alias.isAlias && alias.aliasOf === row.fseiban).map(alias => alias.fseiban)]));
  const seibans = [...new Set(roots.flatMap(row => [row.fseiban, ...(aliases.get(row.fseiban) ?? [])]))];
  const machineNamesPending = resolveSeibanMachineDisplayNamesBatched(roots.map(row => row.fseiban));
  const parts = await prisma.$queryRaw<PartRow[]>`
    SELECT MIN(r."rowData"->>'FSEIBAN') AS "fseiban", r."rowData"->>'ProductNo' AS "productNo",
      MIN(r."rowData"->>'FHINCD') AS "fhincd", MIN(r."rowData"->>'FHINMEI') AS "fhinmei",
      bool_and(${buildProductionScheduleEffectiveCompletedSql()}) AS "completed"
    FROM "CsvDashboardRow" r
    LEFT JOIN "ProductionScheduleProgress" p ON p."csvDashboardRowId" = r.id AND p."csvDashboardId" = r."csvDashboardId"
    LEFT JOIN "ProductionScheduleExternalCompletion" ext ON ext."csvDashboardRowId" = r.id AND ext."csvDashboardId" = r."csvDashboardId"
    WHERE r."csvDashboardId" = ${PRODUCTION_SCHEDULE_DASHBOARD_ID}
      AND r."rowData"->>'FSEIBAN' = ANY(${seibans}::text[])
      AND COALESCE(r."rowData"->>'ProductNo', '') <> ''
      AND ${buildMaxProductNoWinnerCondition('r')}
    GROUP BY r."rowData"->>'ProductNo'
    ORDER BY r."rowData"->>'ProductNo'
  `;
  const { machineNames } = await machineNamesPending;
  const productNos = [...new Set(parts.map(part => part.productNo))];
  const [records, branches, haizen] = productNos.length ? await Promise.all([
    prisma.$queryRaw<{ transferOrderBarcodeRaw: string }[]>`
      SELECT "transferOrderBarcodeRaw" FROM "mobile_slip_verify_records"
      WHERE outcome = 'match' AND ${tokenSql(Prisma.sql`"transferOrderBarcodeRaw"`)} = ANY(${productNos}::text[])
    `,
    prisma.$queryRaw<PlacementRow[]>`
      SELECT "manufacturingOrderBarcodeRaw", "shelfCodeRaw", slip_kind AS "slipKind", "scheduleSnapshot", "updatedAt"
      FROM "OrderPlacementBranchState"
      WHERE (slip_kind <> 'purchase_order' AND ${tokenSql(Prisma.sql`"manufacturingOrderBarcodeRaw"`)} = ANY(${productNos}::text[]))
        OR (slip_kind = 'purchase_order' AND btrim("scheduleSnapshot"->>'FSEIBAN') = ANY(${seibans}::text[]))
    `,
    prisma.$queryRaw<PlacementRow[]>`
      SELECT "manufacturingOrderBarcodeRaw", "shelfCodeRaw", 'manufacturing_order' AS "slipKind", "scheduleSnapshot", "updatedAt"
      FROM "HaizenCurrentPlacement"
      WHERE ${tokenSql(Prisma.sql`"manufacturingOrderBarcodeRaw"`)} = ANY(${productNos}::text[])
    `
  ]) : [[], [], []];
  const placements = [...branches, ...haizen].sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());
  const shelfCodes = [...new Set(placements.map(row => row.shelfCodeRaw))];
  const shelves = shelfCodes.length ? await prisma.$queryRaw<{ shelfCodeRaw: string; displayLabel: string | null }[]>`
    SELECT "shelfCodeRaw", "displayLabel" FROM "MobilePlacementShelf" WHERE "shelfCodeRaw" = ANY(${shelfCodes}::text[])
  ` : [];
  const labels = new Map(shelves.map(row => [row.shelfCodeRaw, row.displayLabel || row.shelfCodeRaw]));
  const verified = new Set(records.map(row => normalizeSlipToken(row.transferOrderBarcodeRaw)));
  const orderShelves = new Map<string, PlacementRow>();
  const purchaseShelves = new Map<string, PlacementRow>();
  for (const row of placements) {
    const key = row.slipKind === 'purchase_order'
      ? `${textField(row.scheduleSnapshot, 'FSEIBAN').trim()}\0${normalizePurchaseFhinCdForMatching(textField(row.scheduleSnapshot, 'FHINCD'))}`
      : normalizeSlipToken(row.manufacturingOrderBarcodeRaw);
    if (row.slipKind === 'purchase_order' && !normalizePurchaseFhinCdForMatching(textField(row.scheduleSnapshot, 'FHINCD'))) continue;
    const map = row.slipKind === 'purchase_order' ? purchaseShelves : orderShelves;
    if (!map.has(key)) map.set(key, row);
  }
  return roots.map(row => {
    const group = new Set([row.fseiban, ...(aliases.get(row.fseiban) ?? [])]);
    const groupParts = parts.filter(part => group.has(part.fseiban));
    const seen = new Set<string>();
    const counts = { shelf: 0, verified: 0, pending: 0, done: 0 };
    const resultParts = groupParts.filter(part => !seen.has(part.productNo) && !!seen.add(part.productNo)).map(part => {
      const orderShelf = orderShelves.get(part.productNo);
      const purchaseShelf = purchaseShelves.get(`${part.fseiban}\0${normalizePurchaseFhinCdForMatching(part.fhincd ?? '')}`);
      const shelf = orderShelf && purchaseShelf
        ? (orderShelf.updatedAt >= purchaseShelf.updatedAt ? orderShelf : purchaseShelf)
        : orderShelf ?? purchaseShelf;
      const state: SchedulePartState = part.completed ? 'done' : shelf ? 'shelf' : verified.has(part.productNo) ? 'verified' : 'pending';
      counts[state]++;
      return { productNo: part.productNo, fhincd: part.fhincd ?? '', fhinmei: part.fhinmei ?? '', state,
        ...(shelf ? { shelfCodeRaw: shelf.shelfCodeRaw, shelfLabel: labels.get(shelf.shelfCodeRaw) ?? shelf.shelfCodeRaw } : {}) };
    });
    return { fseiban: row.fseiban, aliasFseibans: aliases.get(row.fseiban) ?? [], ...readScheduleDates(row),
      outsourceMarks: row.outsourceMarks, memo: row.memo,
      machineName: isMissingSeibanMachineName(machineNames[row.fseiban]) ? null : machineNames[row.fseiban] ?? null, counts, parts: resultParts };
  });
}

export async function listScheduleSeibans(): Promise<{ seibans: ScheduleSeibanSummary[]; truncated: boolean }> {
  const rows = (await aggregateScheduleSeibans()).filter(row => row.counts.shelf + row.counts.verified + row.counts.pending > 0);
  return { seibans: rows.slice(0, LIST_LIMIT).map(row => { const { parts, ...summary } = row; void parts; return summary; }), truncated: rows.length > LIST_LIMIT };
}

export async function getScheduleSeiban(fseiban: string): Promise<ScheduleSeibanDetail | null> {
  return (await aggregateScheduleSeibans(fseiban))[0] ?? null;
}
