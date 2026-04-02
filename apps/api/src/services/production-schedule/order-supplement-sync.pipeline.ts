/**
 * Production schedule order supplement sync: read/normalize → plan → short DB write.
 * DB write uses delete-all-for-source + batched createMany (no long per-row upsert loop).
 */
import { Prisma, type PrismaClient } from '@prisma/client';

import {
  PRODUCTION_SCHEDULE_DASHBOARD_ID,
  PRODUCTION_SCHEDULE_ORDER_SUPPLEMENT_DASHBOARD_ID,
} from './constants.js';
import { normalizeProductionScheduleResourceCd } from './policies/resource-category-policy.service.js';
import { buildMaxProductNoWinnerCondition } from './row-resolver/index.js';

const CREATE_MANY_CHUNK_SIZE = 200;
/** Interactive transaction: avoid default ~5s cap on slow hosts / large CSVs */
const REPLACEMENT_TX_TIMEOUT_MS = 60_000;
const REPLACEMENT_TX_MAX_WAIT_MS = 15_000;

export type SupplementNormalizedRow = {
  sourceRowId: string;
  productNo: string;
  resourceCd: string;
  processOrder: string;
  plannedQuantity: number | null;
  plannedStartDate: Date | null;
  plannedEndDate: Date | null;
};

type WinnerKeyRow = {
  id: string;
  productNo: string | null;
  resourceCd: string | null;
  processOrder: string | null;
};

export type OrderSupplementSyncResult = {
  scanned: number;
  normalized: number;
  matched: number;
  unmatched: number;
  upserted: number;
  pruned: number;
};

const normalizeToken = (value: unknown): string => String(value ?? '').trim();

export const buildOrderSupplementKey = (params: {
  productNo: string;
  resourceCd: string;
  processOrder: string;
}): string => `${params.productNo}\t${params.resourceCd}\t${params.processOrder}`;

const parseQuantity = (value: unknown): number | null => {
  const normalized = normalizeToken(value);
  if (normalized.length === 0) return null;
  if (!/^-?\d+$/.test(normalized)) return null;
  return Number.parseInt(normalized, 10);
};

const parsePlannedDate = (value: unknown): Date | null => {
  const normalized = normalizeToken(value);
  if (normalized.length === 0) return null;

  const ymdMatch = normalized.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (ymdMatch) {
    const [, y, m, d] = ymdMatch;
    const date = new Date(`${y}-${m}-${d}T00:00:00.000Z`);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  const mdYMatch = normalized.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s+\d{1,2}:\d{1,2}(?::\d{1,2})?)?$/);
  if (!mdYMatch) return null;
  const [, m, d, y] = mdYMatch;
  const month = m.padStart(2, '0');
  const day = d.padStart(2, '0');
  const date = new Date(`${y}-${month}-${day}T00:00:00.000Z`);
  return Number.isNaN(date.getTime()) ? null : date;
};

export function toSupplementNormalizedRow(
  sourceRowId: string,
  rowData: Record<string, unknown>
): SupplementNormalizedRow | null {
  const productNo = normalizeToken(rowData.ProductNo);
  const processOrder = normalizeToken(rowData.FKOJUN);
  const resourceCd = normalizeProductionScheduleResourceCd(normalizeToken(rowData.FSIGENCD));
  if (productNo.length === 0 || processOrder.length === 0 || resourceCd.length === 0) {
    return null;
  }
  return {
    sourceRowId,
    productNo,
    resourceCd,
    processOrder,
    plannedQuantity: parseQuantity(rowData.plannedQuantity),
    plannedStartDate: parsePlannedDate(rowData.plannedStartDate),
    plannedEndDate: parsePlannedDate(rowData.plannedEndDate),
  };
}

export function dedupeSupplementRows(rows: SupplementNormalizedRow[]): SupplementNormalizedRow[] {
  const dedupedByKey = new Map<string, SupplementNormalizedRow>();
  for (const row of rows) {
    const key = buildOrderSupplementKey({
      productNo: row.productNo,
      resourceCd: row.resourceCd,
      processOrder: row.processOrder,
    });
    dedupedByKey.set(key, row);
  }
  return [...dedupedByKey.values()];
}

export async function loadSupplementSourceRows(client: PrismaClient): Promise<{
  scanned: number;
  normalizedRows: SupplementNormalizedRow[];
}> {
  const sourceRows = await client.csvDashboardRow.findMany({
    where: { csvDashboardId: PRODUCTION_SCHEDULE_ORDER_SUPPLEMENT_DASHBOARD_ID },
    select: { id: true, rowData: true },
  });

  const normalizedRows = sourceRows
    .map((row) => toSupplementNormalizedRow(row.id, row.rowData as Record<string, unknown>))
    .filter((row): row is SupplementNormalizedRow => row !== null);

  return { scanned: sourceRows.length, normalizedRows };
}

export async function resolveWinnerIdByKey(
  client: PrismaClient,
  dedupedRows: SupplementNormalizedRow[]
): Promise<Map<string, string>> {
  if (dedupedRows.length === 0) {
    return new Map();
  }

  const productNos = [...new Set(dedupedRows.map((row) => row.productNo))];
  const resourceCds = [...new Set(dedupedRows.map((row) => row.resourceCd))];
  const processOrders = [...new Set(dedupedRows.map((row) => row.processOrder))];

  const winnerRows = await client.$queryRaw<WinnerKeyRow[]>`
    SELECT
      "CsvDashboardRow"."id" AS "id",
      "CsvDashboardRow"."rowData"->>'ProductNo' AS "productNo",
      UPPER(BTRIM("CsvDashboardRow"."rowData"->>'FSIGENCD')) AS "resourceCd",
      BTRIM("CsvDashboardRow"."rowData"->>'FKOJUN') AS "processOrder"
    FROM "CsvDashboardRow"
    WHERE "CsvDashboardRow"."csvDashboardId" = ${PRODUCTION_SCHEDULE_DASHBOARD_ID}
      AND ${buildMaxProductNoWinnerCondition('CsvDashboardRow')}
      AND ("CsvDashboardRow"."rowData"->>'ProductNo') IN (${Prisma.join(productNos.map((value) => Prisma.sql`${value}`), ',')})
      AND UPPER(BTRIM("CsvDashboardRow"."rowData"->>'FSIGENCD')) IN (${Prisma.join(resourceCds.map((value) => Prisma.sql`${value}`), ',')})
      AND BTRIM("CsvDashboardRow"."rowData"->>'FKOJUN') IN (${Prisma.join(processOrders.map((value) => Prisma.sql`${value}`), ',')})
  `;

  const winnerIdByKey = new Map<string, string>();
  for (const row of winnerRows) {
    const productNo = normalizeToken(row.productNo);
    const resourceCd = normalizeProductionScheduleResourceCd(normalizeToken(row.resourceCd));
    const processOrder = normalizeToken(row.processOrder);
    if (productNo.length === 0 || resourceCd.length === 0 || processOrder.length === 0) continue;
    winnerIdByKey.set(buildOrderSupplementKey({ productNo, resourceCd, processOrder }), row.id);
  }
  return winnerIdByKey;
}

export function buildReplacementCreateInputs(
  dedupedRows: SupplementNormalizedRow[],
  winnerIdByKey: Map<string, string>
): {
  matched: number;
  unmatched: number;
  createInputs: Prisma.ProductionScheduleOrderSupplementCreateManyInput[];
} {
  let matched = 0;
  let unmatched = 0;
  const createInputs: Prisma.ProductionScheduleOrderSupplementCreateManyInput[] = [];

  for (const row of dedupedRows) {
    const key = buildOrderSupplementKey({
      productNo: row.productNo,
      resourceCd: row.resourceCd,
      processOrder: row.processOrder,
    });
    const winnerRowId = winnerIdByKey.get(key);
    if (!winnerRowId) {
      unmatched += 1;
      continue;
    }
    matched += 1;
    createInputs.push({
      csvDashboardId: PRODUCTION_SCHEDULE_DASHBOARD_ID,
      csvDashboardRowId: winnerRowId,
      sourceCsvDashboardId: PRODUCTION_SCHEDULE_ORDER_SUPPLEMENT_DASHBOARD_ID,
      productNo: row.productNo,
      resourceCd: row.resourceCd,
      processOrder: row.processOrder,
      plannedQuantity: row.plannedQuantity,
      plannedStartDate: row.plannedStartDate,
      plannedEndDate: row.plannedEndDate,
    });
  }

  return { matched, unmatched, createInputs };
}

export async function runOrderSupplementReplacementTransaction(
  client: PrismaClient,
  params: {
    scanned: number;
    normalized: number;
    matched: number;
    unmatched: number;
    createInputs: Prisma.ProductionScheduleOrderSupplementCreateManyInput[];
  }
): Promise<OrderSupplementSyncResult> {
  return client.$transaction(
    async (tx) => {
      const pruneResult = await tx.productionScheduleOrderSupplement.deleteMany({
        where: {
          csvDashboardId: PRODUCTION_SCHEDULE_DASHBOARD_ID,
          sourceCsvDashboardId: PRODUCTION_SCHEDULE_ORDER_SUPPLEMENT_DASHBOARD_ID,
        },
      });

      let inserted = 0;
      for (let i = 0; i < params.createInputs.length; i += CREATE_MANY_CHUNK_SIZE) {
        const chunk = params.createInputs.slice(i, i + CREATE_MANY_CHUNK_SIZE);
        if (chunk.length === 0) continue;
        const batch = await tx.productionScheduleOrderSupplement.createMany({ data: chunk });
        inserted += batch.count;
      }

      if (inserted !== params.createInputs.length) {
        throw new Error(
          `[OrderSupplementSync] insert count mismatch: expected ${params.createInputs.length}, got ${inserted}`
        );
      }

      return {
        scanned: params.scanned,
        normalized: params.normalized,
        matched: params.matched,
        unmatched: params.unmatched,
        upserted: inserted,
        pruned: pruneResult.count,
      };
    },
    {
      maxWait: REPLACEMENT_TX_MAX_WAIT_MS,
      timeout: REPLACEMENT_TX_TIMEOUT_MS,
    }
  );
}

export async function runOrderSupplementClearTransaction(client: PrismaClient, scanned: number): Promise<OrderSupplementSyncResult> {
  return client.$transaction(
    async (tx) => {
      const pruneResult = await tx.productionScheduleOrderSupplement.deleteMany({
        where: {
          csvDashboardId: PRODUCTION_SCHEDULE_DASHBOARD_ID,
          sourceCsvDashboardId: PRODUCTION_SCHEDULE_ORDER_SUPPLEMENT_DASHBOARD_ID,
        },
      });
      return {
        scanned,
        normalized: 0,
        matched: 0,
        unmatched: 0,
        upserted: 0,
        pruned: pruneResult.count,
      };
    },
    {
      maxWait: REPLACEMENT_TX_MAX_WAIT_MS,
      timeout: REPLACEMENT_TX_TIMEOUT_MS,
    }
  );
}
