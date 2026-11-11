import { Prisma } from '@prisma/client';

import { prisma } from '../../lib/prisma.js';
import { PRODUCTION_SCHEDULE_DASHBOARD_ID } from './constants.js';
import { buildGrindingPlanningBoardRowItemId } from './grinding-planning-board-projection.js';
import { getResourceCategoryPolicy, isProductionScheduleExcludedCuttingResourceCd } from './policies/resource-category-policy.service.js';
import { buildProductionScheduleEffectiveCompletedSql } from './production-schedule-effective-completion.sql.js';
import { isUnassignedProductionSeiban } from './row-resolver/constants.js';
import type { GrindingPlanningBoardSpecialDue } from '@raspi-system/shared-types';

export type ArrivalProcess = { fseiban: string; fhincd: string; productNo: string; processOrder: string; resourceCd: string; isCompleted: boolean };
type ArrivalRow = { id: string; sourceRowId?: string; rowData: unknown; placement?: unknown };
const field = (data: unknown, key: string): string => {
  const value = data && typeof data === 'object' ? (data as Record<string, unknown>)[key] : undefined;
  return value == null ? '' : String(value).trim();
};
const partKey = (p: Pick<ArrivalProcess, 'fseiban' | 'fhincd' | 'productNo'>) =>
  JSON.stringify([p.fseiban.trim(), p.fhincd.trim(), isUnassignedProductionSeiban(p.fseiban) ? p.productNo.trim() : '']);
const order = (value: string) => /^\d+$/.test(value.trim()) ? Number(value) : null;

type ProcessArrival = { arrived: boolean; isFirstProcess: boolean };
export function buildProcessArrivalByRowId(rows: readonly ArrivalRow[], processes: readonly ArrivalProcess[],
  isExcluded: (resourceCd: string) => boolean, placedProductNos: ReadonlySet<string> | undefined,
  options: { includeFirstProcess: true }): Map<string, ProcessArrival>;
export function buildProcessArrivalByRowId(rows: readonly ArrivalRow[], processes: readonly ArrivalProcess[],
  isExcluded: (resourceCd: string) => boolean, placedProductNos?: ReadonlySet<string>,
  options?: { includeFirstProcess?: false }): Map<string, boolean>;
export function buildProcessArrivalByRowId(rows: readonly ArrivalRow[], processes: readonly ArrivalProcess[],
  isExcluded: (resourceCd: string) => boolean, placedProductNos: ReadonlySet<string> = new Set(),
  options?: { includeFirstProcess?: boolean }): Map<string, boolean | ProcessArrival> {
  const incompleteByPart = new Map<string, number[]>();
  const allByPart = new Map<string, number[]>();
  for (const process of processes) {
    const processOrder = order(process.processOrder);
    if (isExcluded(process.resourceCd.trim()) || processOrder == null) continue;
    const key = partKey(process);
    const all = allByPart.get(key) ?? [];
    all.push(processOrder);
    allByPart.set(key, all);
    if (process.isCompleted) continue;
    const earlier = incompleteByPart.get(key) ?? [];
    earlier.push(processOrder);
    incompleteByPart.set(key, earlier);
  }
  return new Map(rows.map((row) => {
    const productNo = field(row.rowData, 'ProductNo');
    const key = partKey({ fseiban: field(row.rowData, 'FSEIBAN'), fhincd: field(row.rowData, 'FHINCD'), productNo });
    const ownOrder = order(field(row.rowData, 'FKOJUN'));
    const arrived = Boolean(row.placement) || placedProductNos.has(productNo) || ownOrder == null ||
      !(incompleteByPart.get(key) ?? []).some((previous) => previous < ownOrder);
    const isFirstProcess = ownOrder == null || !(allByPart.get(key) ?? []).some((previous) => previous < ownOrder);
    return [row.id, options?.includeFirstProcess ? { arrived, isFirstProcess } : arrived];
  }));
}

/** Read every process of each part, across grinding/cutting and completion filters. */
export async function enrichRowsWithProcessArrival<T extends ArrivalRow>(rows: readonly T[], params: {
  siteKey?: string; locationKey: string; includeSpecialDue?: boolean; placedProductNos?: ReadonlySet<string>; includeFirstProcess?: boolean; client?: Prisma.TransactionClient; policy?: Awaited<ReturnType<typeof getResourceCategoryPolicy>>;
}): Promise<Array<T & { arrived: boolean; isFirstProcess?: boolean; specialDue?: GrindingPlanningBoardSpecialDue | null }>> {
  if (!rows.length) return [];
  const client = params.client ?? prisma;
  const keys = [...new Map(rows.map((row) => {
    const p = { fseiban: field(row.rowData, 'FSEIBAN'), fhincd: field(row.rowData, 'FHINCD'), productNo: field(row.rowData, 'ProductNo') };
    return [partKey(p), p];
  })).values()].filter((p) => p.fseiban && p.fhincd);
  const policy = params.policy ?? await getResourceCategoryPolicy({ siteKey: params.siteKey, deviceScopeKey: params.locationKey });
  const preferredIds = [...new Set(rows.map((row) => row.sourceRowId ?? row.id))];
  const fseibans = keys.map((key) => key.fseiban);
  const fhincds = keys.map((key) => key.fhincd);
  const keyProductNos = keys.map((key) => isUnassignedProductionSeiban(key.fseiban) ? key.productNo : null);
  // Footer chips match ProductNo even for ordinary parts; arrival intentionally spans
  // those ProductNos. Keys are unique per ordinary part or unassigned ProductNo,
  // so joining them keeps the same candidates as EXISTS and permits indexed lookups.
  const processes = keys.length ? await client.$queryRaw<ArrivalProcess[]>(Prisma.sql`
    WITH "winnerRows" AS (
      SELECT DISTINCT ON (
        BTRIM("rowData"->>'FSEIBAN'), BTRIM("rowData"->>'FHINCD'),
        BTRIM("rowData"->>'FSIGENCD'), BTRIM("rowData"->>'FKOJUN'),
        CASE WHEN BTRIM("rowData"->>'FSEIBAN') = '********' THEN BTRIM("rowData"->>'ProductNo') ELSE '' END
      ) "CsvDashboardRow".*
      FROM unnest(${fseibans}::text[], ${fhincds}::text[], ${keyProductNos}::text[]) AS k(fseiban, fhincd, product_no)
      INNER JOIN "CsvDashboardRow"
        ON "csvDashboardId" = ${PRODUCTION_SCHEDULE_DASHBOARD_ID}
        AND BTRIM("rowData"->>'FSEIBAN') = k.fseiban
        AND BTRIM("rowData"->>'FHINCD') = k.fhincd
        AND (k.product_no IS NULL OR BTRIM("rowData"->>'ProductNo') = k.product_no)
      ORDER BY BTRIM("rowData"->>'FSEIBAN'), BTRIM("rowData"->>'FHINCD'), BTRIM("rowData"->>'FSIGENCD'), BTRIM("rowData"->>'FKOJUN'),
        CASE WHEN BTRIM("rowData"->>'FSEIBAN') = '********' THEN BTRIM("rowData"->>'ProductNo') ELSE '' END,
        ("id" IN (${Prisma.join(preferredIds)})) DESC,
        CASE WHEN ("rowData"->>'ProductNo') ~ '^[0-9]+$' THEN ("rowData"->>'ProductNo')::bigint ELSE -1 END DESC,
        "createdAt" DESC, "id" DESC
    ) SELECT "winnerRows"."rowData"->>'FSEIBAN' AS "fseiban", "winnerRows"."rowData"->>'FHINCD' AS "fhincd",
      COALESCE("winnerRows"."rowData"->>'ProductNo', '') AS "productNo",
      COALESCE("winnerRows"."rowData"->>'FKOJUN', '') AS "processOrder",
      COALESCE("winnerRows"."rowData"->>'FSIGENCD', '') AS "resourceCd",
      ${buildProductionScheduleEffectiveCompletedSql()} AS "isCompleted"
    FROM "winnerRows"
    LEFT JOIN "ProductionScheduleProgress" AS "p" ON "p"."csvDashboardRowId" = "winnerRows"."id" AND "p"."csvDashboardId" = ${PRODUCTION_SCHEDULE_DASHBOARD_ID}
    LEFT JOIN "ProductionScheduleExternalCompletion" AS "ext" ON "ext"."csvDashboardRowId" = "winnerRows"."id" AND "ext"."csvDashboardId" = ${PRODUCTION_SCHEDULE_DASHBOARD_ID}
    `) : [];
  const productNos = [...new Set(rows.map((r) => field(r.rowData, 'ProductNo')).filter(Boolean))];
  const placements = !params.placedProductNos && productNos.length ? await client.orderPlacementBranchState.findMany({
    where: { slipKind: 'manufacturing_order', manufacturingOrderBarcodeRaw: { in: productNos } },
    select: { manufacturingOrderBarcodeRaw: true }
  }) : [];
  const arrival = buildProcessArrivalByRowId(rows, processes,
    (cd) => isProductionScheduleExcludedCuttingResourceCd(cd, policy), params.placedProductNos ?? new Set(placements.map((p) => p.manufacturingOrderBarcodeRaw)), { includeFirstProcess: true });
  const itemKey = (row: T) => (row.id.startsWith('piece:') || row.id.startsWith('pieceops:')) ? row.id : buildGrindingPlanningBoardRowItemId(row.rowData as Record<string, unknown>);
  const overrides = params.includeSpecialDue ? await client.productionScheduleGrindingPlanningBoardOverride.findMany({
    where: { csvDashboardId: PRODUCTION_SCHEDULE_DASHBOARD_ID, siteKey: params.siteKey ?? params.locationKey, itemKey: { in: rows.map(itemKey) } }
  }) : [];
  const byKey = new Map(overrides.map((o) => [o.itemKey, o]));
  return rows.map((row) => {
    const override = params.includeSpecialDue ? byKey.get(itemKey(row)) : undefined;
    const specialDue = override && (override.specialDueKind === 'today' || override.specialDueKind === 'overnight') && override.specialDueExpiresAt
      ? { kind: override.specialDueKind, expiresAt: override.specialDueExpiresAt.toISOString() } as GrindingPlanningBoardSpecialDue : null;
    return { ...row, arrived: arrival.get(row.id)?.arrived ?? true, ...(params.includeFirstProcess ? { isFirstProcess: arrival.get(row.id)?.isFirstProcess ?? true } : {}), ...(params.includeSpecialDue ? { specialDue } : {}) };
  });
}
