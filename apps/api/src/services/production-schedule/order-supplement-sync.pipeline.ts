/**
 * Production schedule order supplement sync: read/normalize → plan → short DB write.
 * DB write uses incremental create/update + retention prune.
 */
import { Prisma, type PrismaClient } from '@prisma/client';

import {
  PRODUCTION_SCHEDULE_DASHBOARD_ID,
  PRODUCTION_SCHEDULE_ORDER_SUPPLEMENT_DASHBOARD_ID,
} from './constants.js';
import { normalizeProductionScheduleResourceCd } from './policies/resource-category-policy.service.js';
import { buildMaxProductNoWinnerCondition } from './row-resolver/index.js';

const CREATE_MANY_CHUNK_SIZE = 200;
const UPDATE_CHUNK_SIZE = 100;
/** Interactive transaction: avoid default ~5s cap on slow hosts / large CSVs */
const REPLACEMENT_TX_TIMEOUT_MS = 60_000;
const REPLACEMENT_TX_MAX_WAIT_MS = 15_000;
const RETENTION_YEARS = 1;

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

type ExistingSupplementRow = {
  id: string;
  csvDashboardRowId: string;
  productNo: string;
  resourceCd: string;
  processOrder: string;
  plannedQuantity: number | null;
  plannedStartDate: Date | null;
  plannedEndDate: Date | null;
  plannedStartDateManuallySet: boolean;
};

type ExistingSupplementMap = Map<string, ExistingSupplementRow>;

const parseQuantity = (value: unknown): number | null => {
  const normalized = normalizeToken(value);
  if (normalized.length === 0) return null;
  if (!/^-?\d+$/.test(normalized)) return null;
  return Number.parseInt(normalized, 10);
};

const parsePlannedDate = (value: unknown): Date | null => {
  const normalized = normalizeToken(value);
  if (normalized.length === 0) return null;

  const isoPrefixMatch = normalized.match(
    /^(\d{4})-(\d{2})-(\d{2})(?:[T\s]\d{1,2}:\d{1,2}(?::\d{1,2})?(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})?)?$/
  );
  if (isoPrefixMatch) {
    const [, y, m, d] = isoPrefixMatch;
    const date = new Date(`${y}-${m}-${d}T00:00:00.000Z`);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  const ymdMatch = normalized.match(/^(\d{4})\/(\d{1,2})\/(\d{1,2})(?:\s+\d{1,2}:\d{1,2}(?::\d{1,2})?)?$/);
  if (ymdMatch) {
    const [, y, m, d] = ymdMatch;
    const month = m.padStart(2, '0');
    const day = d.padStart(2, '0');
    const date = new Date(`${y}-${month}-${day}T00:00:00.000Z`);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  const mdYMatch = normalized.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s+\d{1,2}:\d{1,2}(?::\d{1,2})?)?$/);
  if (!mdYMatch) {
    // #region agent log
    fetch('http://127.0.0.1:7426/ingest/2502f74a-7c46-49e5-b1c6-8c32b7781f8e',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'48d506'},body:JSON.stringify({sessionId:'48d506',runId:'run-initial',hypothesisId:'H1',location:'order-supplement-sync.pipeline.ts:parsePlannedDate',message:'planned date format rejected',data:{raw:String(value ?? ''),normalized},timestamp:Date.now()})}).catch(()=>{});
    // #endregion
    return null;
  }
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
  // #region agent log
  fetch('http://127.0.0.1:7426/ingest/2502f74a-7c46-49e5-b1c6-8c32b7781f8e',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'48d506'},body:JSON.stringify({sessionId:'48d506',runId:'run-initial',hypothesisId:'H2',location:'order-supplement-sync.pipeline.ts:toSupplementNormalizedRow',message:'supplement row normalize input',data:{sourceRowId,hasPlannedEndDateKey:Object.prototype.hasOwnProperty.call(rowData,'plannedEndDate'),plannedEndDateRaw:typeof rowData.plannedEndDate==='string'?rowData.plannedEndDate:null,productNo,processOrder,resourceCd},timestamp:Date.now()})}).catch(()=>{});
  // #endregion
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
  winnerIdByKey: Map<string, string>,
  existingByKey: ExistingSupplementMap,
  now: Date
): {
  matched: number;
  unmatched: number;
  createInputs: Prisma.ProductionScheduleOrderSupplementCreateManyInput[];
  updateInputs: Array<{ id: string; data: Prisma.ProductionScheduleOrderSupplementUncheckedUpdateInput }>;
} {
  let matched = 0;
  let unmatched = 0;
  const createInputs: Prisma.ProductionScheduleOrderSupplementCreateManyInput[] = [];
  const updateInputs: Array<{ id: string; data: Prisma.ProductionScheduleOrderSupplementUncheckedUpdateInput }> = [];

  for (const row of dedupedRows) {
    const key = buildOrderSupplementKey({
      productNo: row.productNo,
      resourceCd: row.resourceCd,
      processOrder: row.processOrder,
    });
    const winnerRowId = winnerIdByKey.get(key);
    if (!winnerRowId) {
      // #region agent log
      fetch('http://127.0.0.1:7426/ingest/2502f74a-7c46-49e5-b1c6-8c32b7781f8e',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'48d506'},body:JSON.stringify({sessionId:'48d506',runId:'run-initial',hypothesisId:'H3',location:'order-supplement-sync.pipeline.ts:buildReplacementCreateInputs',message:'supplement row unmatched to winner',data:{productNo:row.productNo,resourceCd:row.resourceCd,processOrder:row.processOrder,plannedEndDate:row.plannedEndDate?row.plannedEndDate.toISOString():null},timestamp:Date.now()})}).catch(()=>{});
      // #endregion
      unmatched += 1;
      continue;
    }
    matched += 1;
    const existing = existingByKey.get(key);
    if (!existing) {
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
        plannedStartDateManuallySet: false,
        lastSeenAt: now,
      });
      continue;
    }

    // 手動補正は上書きせず、CSV 側が空でも既存非 null を消さない。
    const nextPlannedStartDate = existing.plannedStartDateManuallySet
      ? existing.plannedStartDate
      : row.plannedStartDate ?? existing.plannedStartDate;

    updateInputs.push({
      id: existing.id,
      data: {
        csvDashboardRowId: winnerRowId,
        plannedQuantity: row.plannedQuantity,
        plannedStartDate: nextPlannedStartDate,
        plannedEndDate: row.plannedEndDate,
        lastSeenAt: now,
      },
    });
  }

  return { matched, unmatched, createInputs, updateInputs };
}

export async function runOrderSupplementReplacementTransaction(
  client: PrismaClient,
  params: {
    scanned: number;
    normalized: number;
    matched: number;
    unmatched: number;
    createInputs: Prisma.ProductionScheduleOrderSupplementCreateManyInput[];
    updateInputs: Array<{ id: string; data: Prisma.ProductionScheduleOrderSupplementUncheckedUpdateInput }>;
  }
): Promise<OrderSupplementSyncResult> {
  const retentionCutoff = new Date();
  retentionCutoff.setUTCFullYear(retentionCutoff.getUTCFullYear() - RETENTION_YEARS);

  return client.$transaction(
    async (tx) => {
      let inserted = 0;
      for (let i = 0; i < params.createInputs.length; i += CREATE_MANY_CHUNK_SIZE) {
        const chunk = params.createInputs.slice(i, i + CREATE_MANY_CHUNK_SIZE);
        if (chunk.length === 0) continue;
        const batch = await tx.productionScheduleOrderSupplement.createMany({ data: chunk });
        inserted += batch.count;
      }

      for (let i = 0; i < params.updateInputs.length; i += UPDATE_CHUNK_SIZE) {
        const chunk = params.updateInputs.slice(i, i + UPDATE_CHUNK_SIZE);
        await Promise.all(
          chunk.map((entry) =>
            tx.productionScheduleOrderSupplement.update({
              where: { id: entry.id },
              data: entry.data,
            })
          )
        );
      }

      const pruneResult = await tx.productionScheduleOrderSupplement.deleteMany({
        where: {
          csvDashboardId: PRODUCTION_SCHEDULE_DASHBOARD_ID,
          sourceCsvDashboardId: PRODUCTION_SCHEDULE_ORDER_SUPPLEMENT_DASHBOARD_ID,
          plannedStartDate: { lt: retentionCutoff },
          plannedStartDateManuallySet: false,
        },
      });

      return {
        scanned: params.scanned,
        normalized: params.normalized,
        matched: params.matched,
        unmatched: params.unmatched,
        upserted: inserted + params.updateInputs.length,
        pruned: pruneResult.count,
      };
    },
    {
      maxWait: REPLACEMENT_TX_MAX_WAIT_MS,
      timeout: REPLACEMENT_TX_TIMEOUT_MS,
    }
  );
}

export async function loadExistingSupplementsByKey(client: PrismaClient): Promise<ExistingSupplementMap> {
  const rows = await client.productionScheduleOrderSupplement.findMany({
    where: {
      csvDashboardId: PRODUCTION_SCHEDULE_DASHBOARD_ID,
      sourceCsvDashboardId: PRODUCTION_SCHEDULE_ORDER_SUPPLEMENT_DASHBOARD_ID,
    },
    select: {
      id: true,
      csvDashboardRowId: true,
      productNo: true,
      resourceCd: true,
      processOrder: true,
      plannedQuantity: true,
      plannedStartDate: true,
      plannedEndDate: true,
      plannedStartDateManuallySet: true,
    },
  });

  const byKey: ExistingSupplementMap = new Map();
  for (const row of rows) {
    byKey.set(
      buildOrderSupplementKey({
        productNo: row.productNo,
        resourceCd: row.resourceCd,
        processOrder: row.processOrder,
      }),
      row
    );
  }
  return byKey;
}
