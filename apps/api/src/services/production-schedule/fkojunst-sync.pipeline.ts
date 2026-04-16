/**
 * FKOJUNST Gmail CSV sync: read/normalize → winner resolve → delete-by-source + createMany.
 */
import { Prisma, type PrismaClient } from '@prisma/client';

import {
  PRODUCTION_SCHEDULE_DASHBOARD_ID,
  PRODUCTION_SCHEDULE_FKOJUNST_DASHBOARD_ID,
} from './constants.js';
import { normalizeProductionScheduleResourceCd } from './policies/resource-category-policy.service.js';
import { buildOrderSupplementKey } from './order-supplement-sync.pipeline.js';
import { buildMaxProductNoWinnerCondition } from './row-resolver/index.js';

const CREATE_MANY_CHUNK_SIZE = 200;
const REPLACEMENT_TX_TIMEOUT_MS = 60_000;
const REPLACEMENT_TX_MAX_WAIT_MS = 15_000;

const ALLOWED_STATUS = new Set(['C', 'P', 'S', 'R', 'X']);

export type FkojunstNormalizedRow = {
  sourceRowId: string;
  productNo: string;
  resourceCd: string;
  processOrder: string;
  statusCode: string;
};

type WinnerKeyRow = {
  id: string;
  productNo: string | null;
  resourceCd: string | null;
  processOrder: string | null;
};

export type FkojunstSyncResult = {
  scanned: number;
  normalized: number;
  matched: number;
  unmatched: number;
  skippedInvalidStatus: number;
  upserted: number;
  pruned: number;
};

const normalizeToken = (value: unknown): string => String(value ?? '').trim();

function normalizeStatusCode(value: unknown): string | null {
  const s = normalizeToken(value).toUpperCase();
  if (s.length !== 1) return null;
  return ALLOWED_STATUS.has(s) ? s : null;
}

export function toFkojunstNormalizedRow(
  sourceRowId: string,
  rowData: Record<string, unknown>
): FkojunstNormalizedRow | null {
  const productNo = normalizeToken(rowData.ProductNo);
  const processOrder = normalizeToken(rowData.FKOJUN);
  const resourceCd = normalizeProductionScheduleResourceCd(normalizeToken(rowData.FSIGENCD));
  const statusCode = normalizeStatusCode(rowData.FKOJUNST);
  if (productNo.length === 0 || processOrder.length === 0 || resourceCd.length === 0 || !statusCode) {
    return null;
  }
  return {
    sourceRowId,
    productNo,
    resourceCd,
    processOrder,
    statusCode,
  };
}

export function dedupeFkojunstRows(rows: FkojunstNormalizedRow[]): FkojunstNormalizedRow[] {
  const dedupedByKey = new Map<string, FkojunstNormalizedRow>();
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

export async function loadFkojunstSourceRows(client: PrismaClient): Promise<{
  scanned: number;
  normalizedRows: FkojunstNormalizedRow[];
  skippedInvalidStatus: number;
}> {
  const sourceRows = await client.csvDashboardRow.findMany({
    where: { csvDashboardId: PRODUCTION_SCHEDULE_FKOJUNST_DASHBOARD_ID },
    select: { id: true, rowData: true },
  });

  let skippedInvalidStatus = 0;
  const normalizedRows: FkojunstNormalizedRow[] = [];
  for (const row of sourceRows) {
    const rd = row.rowData as Record<string, unknown>;
    const rawStatus = normalizeToken(rd.FKOJUNST);
    if (rawStatus.length > 0 && normalizeStatusCode(rd.FKOJUNST) === null) {
      skippedInvalidStatus += 1;
    }
    const normalized = toFkojunstNormalizedRow(row.id, rd);
    if (normalized) {
      normalizedRows.push(normalized);
    }
  }

  return { scanned: sourceRows.length, normalizedRows, skippedInvalidStatus };
}

export async function resolveFkojunstWinnerIdByKey(
  client: PrismaClient,
  dedupedRows: FkojunstNormalizedRow[]
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

export function buildFkojunstReplacementCreateInputs(
  dedupedRows: FkojunstNormalizedRow[],
  winnerIdByKey: Map<string, string>
): {
  matched: number;
  unmatched: number;
  createInputs: Prisma.ProductionScheduleFkojunstStatusCreateManyInput[];
} {
  let matched = 0;
  let unmatched = 0;
  const createInputs: Prisma.ProductionScheduleFkojunstStatusCreateManyInput[] = [];

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
      sourceCsvDashboardId: PRODUCTION_SCHEDULE_FKOJUNST_DASHBOARD_ID,
      productNo: row.productNo,
      resourceCd: row.resourceCd,
      processOrder: row.processOrder,
      statusCode: row.statusCode,
    });
  }

  return { matched, unmatched, createInputs };
}

export async function runFkojunstReplacementTransaction(
  client: PrismaClient,
  params: {
    scanned: number;
    normalized: number;
    matched: number;
    unmatched: number;
    skippedInvalidStatus: number;
    createInputs: Prisma.ProductionScheduleFkojunstStatusCreateManyInput[];
  }
): Promise<FkojunstSyncResult> {
  return client.$transaction(
    async (tx) => {
      const pruneResult = await tx.productionScheduleFkojunstStatus.deleteMany({
        where: {
          csvDashboardId: PRODUCTION_SCHEDULE_DASHBOARD_ID,
          sourceCsvDashboardId: PRODUCTION_SCHEDULE_FKOJUNST_DASHBOARD_ID,
        },
      });

      let inserted = 0;
      for (let i = 0; i < params.createInputs.length; i += CREATE_MANY_CHUNK_SIZE) {
        const chunk = params.createInputs.slice(i, i + CREATE_MANY_CHUNK_SIZE);
        if (chunk.length === 0) continue;
        const batch = await tx.productionScheduleFkojunstStatus.createMany({ data: chunk });
        inserted += batch.count;
      }

      if (inserted !== params.createInputs.length) {
        throw new Error(
          `[FkojunstSync] insert count mismatch: expected ${params.createInputs.length}, got ${inserted}`
        );
      }

      return {
        scanned: params.scanned,
        normalized: params.normalized,
        matched: params.matched,
        unmatched: params.unmatched,
        skippedInvalidStatus: params.skippedInvalidStatus,
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

export async function runFkojunstClearTransaction(
  client: PrismaClient,
  scanned: number,
  skippedInvalidStatus: number
): Promise<FkojunstSyncResult> {
  return client.$transaction(
    async (tx) => {
      const pruneResult = await tx.productionScheduleFkojunstStatus.deleteMany({
        where: {
          csvDashboardId: PRODUCTION_SCHEDULE_DASHBOARD_ID,
          sourceCsvDashboardId: PRODUCTION_SCHEDULE_FKOJUNST_DASHBOARD_ID,
        },
      });
      return {
        scanned,
        normalized: 0,
        matched: 0,
        unmatched: 0,
        skippedInvalidStatus,
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
