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
import { acquireProductionScheduleParentRowLockInTransaction } from './order-split/production-schedule-parent-row-lock.service.js';

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

type SupplementWinnerLookupKey = {
  productNo: string;
  resourceCd: string;
  processOrder: string;
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

const firstNonBlankToken = (...values: unknown[]): string => {
  for (const value of values) {
    const normalized = normalizeToken(value);
    if (normalized.length > 0) {
      return normalized;
    }
  }
  return '';
};

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

type ReplacementUpdateInput = {
  id: string;
  csvDashboardRowId: string;
  previousCsvDashboardRowId: string;
  previousPlannedQuantity: number | null;
  nextPlannedQuantity: number | null;
  data: Prisma.ProductionScheduleOrderSupplementUncheckedUpdateInput;
};

/**
 * 更新時: CSV からパースした計画納期が無い（空・不正で null）場合は既存値を保持する。
 * 着手日の「CSV 空は既存維持」と同系（手動納期 `dueDate` とは別テーブル）。
 */
const mergePlannedEndDateForUpdate = (fromCsv: Date | null, existing: Date | null): Date | null =>
  fromCsv ?? existing;

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
  const productNo = firstNonBlankToken(rowData.ProductNo, rowData.FSEZONO);
  const processOrder = firstNonBlankToken(rowData.FKOJUN);
  const resourceCd = normalizeProductionScheduleResourceCd(firstNonBlankToken(rowData.FSIGENCD, rowData.FKOTEICD));
  if (productNo.length === 0 || processOrder.length === 0 || resourceCd.length === 0) {
    return null;
  }
  return {
    sourceRowId,
    productNo,
    resourceCd,
    processOrder,
    plannedQuantity: parseQuantity(firstNonBlankToken(rowData.plannedQuantity, rowData.FKOJUNSIJISU)),
    plannedStartDate: parsePlannedDate(firstNonBlankToken(rowData.plannedStartDate, rowData.FKOJUNSTTYOTEIYMD)),
    plannedEndDate: parsePlannedDate(firstNonBlankToken(rowData.plannedEndDate, rowData.FKOJUNENDYOTEIYMD)),
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

  const lookupKeys = dedupedRows.map(
    (row): SupplementWinnerLookupKey => ({
      productNo: row.productNo,
      resourceCd: row.resourceCd,
      processOrder: row.processOrder,
    })
  );
  const lookupKeysJson = JSON.stringify(lookupKeys);

  const winnerRows = await client.$queryRaw<WinnerKeyRow[]>`
    WITH input_keys AS (
      SELECT DISTINCT
        "productNo",
        "resourceCd",
        "processOrder"
      FROM jsonb_to_recordset(CAST(${lookupKeysJson} AS jsonb)) AS key(
        "productNo" text,
        "resourceCd" text,
        "processOrder" text
      )
    )
    SELECT
      "CsvDashboardRow"."id" AS "id",
      "CsvDashboardRow"."rowData"->>'ProductNo' AS "productNo",
      UPPER(BTRIM("CsvDashboardRow"."rowData"->>'FSIGENCD')) AS "resourceCd",
      BTRIM("CsvDashboardRow"."rowData"->>'FKOJUN') AS "processOrder"
    FROM "CsvDashboardRow"
    INNER JOIN input_keys
      ON input_keys."productNo" = "CsvDashboardRow"."rowData"->>'ProductNo'
      AND input_keys."resourceCd" = UPPER(BTRIM("CsvDashboardRow"."rowData"->>'FSIGENCD'))
      AND input_keys."processOrder" = BTRIM("CsvDashboardRow"."rowData"->>'FKOJUN')
    WHERE "CsvDashboardRow"."csvDashboardId" = ${PRODUCTION_SCHEDULE_DASHBOARD_ID}
      AND ${buildMaxProductNoWinnerCondition('CsvDashboardRow')}
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
  updateInputs: ReplacementUpdateInput[];
} {
  let matched = 0;
  let unmatched = 0;
  const createInputs: Prisma.ProductionScheduleOrderSupplementCreateManyInput[] = [];
  const updateInputs: ReplacementUpdateInput[] = [];
  const existingByWinnerRowId = new Map(
    [...existingByKey.values()].map((existing) => [existing.csvDashboardRowId, existing] as const)
  );

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
    const existing = existingByKey.get(key);
    const existingByWinner = existingByWinnerRowId.get(winnerRowId);
    const existingTarget = existing ?? existingByWinner;
    if (existingTarget) {
      const nextPlannedStartDate = existingTarget.plannedStartDateManuallySet
        ? existingTarget.plannedStartDate
        : row.plannedStartDate ?? existingTarget.plannedStartDate;
      const nextPlannedEndDate = mergePlannedEndDateForUpdate(row.plannedEndDate, existingTarget.plannedEndDate);
      updateInputs.push({
        id: existingTarget.id,
        csvDashboardRowId: winnerRowId,
        previousCsvDashboardRowId: existingTarget.csvDashboardRowId,
        previousPlannedQuantity: existingTarget.plannedQuantity,
        nextPlannedQuantity: row.plannedQuantity,
        data: {
          csvDashboardRowId: winnerRowId,
          productNo: row.productNo,
          resourceCd: row.resourceCd,
          processOrder: row.processOrder,
          plannedQuantity: row.plannedQuantity,
          plannedStartDate: nextPlannedStartDate,
          plannedEndDate: nextPlannedEndDate,
          lastSeenAt: now,
        },
      });
      continue;
    }

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
  }

  return { matched, unmatched, createInputs, updateInputs };
}

function allocateSplitQuantities(params: {
  currentQuantities: number[];
  nextTotal: number;
}): number[] {
  const keptCount = Math.min(params.currentQuantities.length, params.nextTotal);
  if (keptCount <= 0) return [];

  const keptQuantities = params.currentQuantities
    .slice(0, keptCount)
    .map((quantity) => (Number.isInteger(quantity) && quantity > 0 ? quantity : 1));
  const weightsTotal = keptQuantities.reduce((sum, quantity) => sum + quantity, 0);
  const allocated = new Array<number>(keptCount).fill(1);
  let remaining = params.nextTotal - keptCount;
  if (remaining <= 0) return allocated;

  const remainders: Array<{ index: number; remainder: number }> = [];
  let floorTotal = 0;
  keptQuantities.forEach((quantity, index) => {
    const exact = (remaining * quantity) / weightsTotal;
    const floor = Math.floor(exact);
    allocated[index] += floor;
    floorTotal += floor;
    remainders.push({ index, remainder: exact - floor });
  });

  remaining -= floorTotal;
  remainders.sort((left, right) => {
    if (right.remainder !== left.remainder) return right.remainder - left.remainder;
    return left.index - right.index;
  });
  for (let i = 0; i < remaining; i += 1) {
    allocated[remainders[i % remainders.length]!.index] += 1;
  }
  return allocated;
}

async function reconcileOrderSplitQuantitiesForSupplementUpdate(
  tx: Prisma.TransactionClient,
  entry: ReplacementUpdateInput
): Promise<void> {
  if (entry.previousPlannedQuantity === entry.nextPlannedQuantity) return;

  const splits = await tx.productionScheduleOrderSplit.findMany({
    where: {
      csvDashboardId: PRODUCTION_SCHEDULE_DASHBOARD_ID,
      parentCsvDashboardRowId: entry.csvDashboardRowId,
    },
    orderBy: { splitNo: 'asc' },
    select: { id: true, splitQuantity: true },
  });
  if (splits.length === 0) return;

  const nextQuantity = entry.nextPlannedQuantity;
  if (nextQuantity == null || !Number.isInteger(nextQuantity) || nextQuantity <= 0) {
    await tx.productionScheduleOrderSplitAssignment.deleteMany({
      where: {
        split: {
          csvDashboardId: PRODUCTION_SCHEDULE_DASHBOARD_ID,
          parentCsvDashboardRowId: entry.csvDashboardRowId,
        },
      },
    });
    await tx.productionScheduleOrderSplit.deleteMany({
      where: {
        csvDashboardId: PRODUCTION_SCHEDULE_DASHBOARD_ID,
        parentCsvDashboardRowId: entry.csvDashboardRowId,
      },
    });
    return;
  }

  const nextQuantities = allocateSplitQuantities({
    currentQuantities: splits.map((split) => split.splitQuantity),
    nextTotal: nextQuantity,
  });
  const keptSplitIds = new Set(splits.slice(0, nextQuantities.length).map((split) => split.id));

  if (keptSplitIds.size < splits.length) {
    await tx.productionScheduleOrderSplit.deleteMany({
      where: {
        csvDashboardId: PRODUCTION_SCHEDULE_DASHBOARD_ID,
        parentCsvDashboardRowId: entry.csvDashboardRowId,
        id: { notIn: [...keptSplitIds] },
      },
    });
  }

  for (let index = 0; index < nextQuantities.length; index += 1) {
    const split = splits[index]!;
    await tx.productionScheduleOrderSplit.update({
      where: { id: split.id },
      data: { splitQuantity: nextQuantities[index]! },
    });
  }
}

async function collectSplitParentIdsForSupplementUpdates(
  tx: Prisma.TransactionClient,
  updateInputs: readonly ReplacementUpdateInput[]
): Promise<Set<string>> {
  const parentRowIds = [
    ...new Set(
      updateInputs.flatMap((entry) => {
        if (
          entry.previousPlannedQuantity === entry.nextPlannedQuantity &&
          entry.previousCsvDashboardRowId === entry.csvDashboardRowId
        ) {
          return [];
        }
        return [entry.previousCsvDashboardRowId, entry.csvDashboardRowId];
      })
    ),
  ];
  if (parentRowIds.length === 0) return new Set();

  const splitParents = await tx.productionScheduleOrderSplit.findMany({
    where: {
      csvDashboardId: PRODUCTION_SCHEDULE_DASHBOARD_ID,
      parentCsvDashboardRowId: { in: parentRowIds },
    },
    distinct: ['parentCsvDashboardRowId'],
    select: { parentCsvDashboardRowId: true },
  });
  return new Set(splitParents.map((split) => split.parentCsvDashboardRowId));
}

async function prepareSplitQuantityReconcileForSupplementUpdate(
  tx: Prisma.TransactionClient,
  entry: ReplacementUpdateInput,
  splitParentIds: ReadonlySet<string>
): Promise<{ parentCsvDashboardRowId: string; keepPreviousParent: boolean } | null> {
  const winnerChanged = entry.previousCsvDashboardRowId !== entry.csvDashboardRowId;
  if (winnerChanged && splitParentIds.has(entry.previousCsvDashboardRowId)) {
    await acquireProductionScheduleParentRowLockInTransaction(tx, entry.previousCsvDashboardRowId);
    return {
      parentCsvDashboardRowId: entry.previousCsvDashboardRowId,
      keepPreviousParent: true,
    };
  }

  if (
    entry.previousPlannedQuantity === entry.nextPlannedQuantity ||
    !splitParentIds.has(entry.csvDashboardRowId)
  ) {
    return null;
  }

  await acquireProductionScheduleParentRowLockInTransaction(tx, entry.csvDashboardRowId);
  return {
    parentCsvDashboardRowId: entry.csvDashboardRowId,
    keepPreviousParent: false,
  };
}

export async function runOrderSupplementReplacementTransaction(
  client: PrismaClient,
  params: {
    scanned: number;
    normalized: number;
    matched: number;
    unmatched: number;
    createInputs: Prisma.ProductionScheduleOrderSupplementCreateManyInput[];
    updateInputs: ReplacementUpdateInput[];
  }
): Promise<OrderSupplementSyncResult> {
  const retentionCutoff = new Date();
  retentionCutoff.setUTCFullYear(retentionCutoff.getUTCFullYear() - RETENTION_YEARS);

  let inserted = 0;
  for (let i = 0; i < params.createInputs.length; i += CREATE_MANY_CHUNK_SIZE) {
    const chunk = params.createInputs.slice(i, i + CREATE_MANY_CHUNK_SIZE);
    if (chunk.length === 0) continue;
    const batchCount = await client.$transaction(
      async (tx) => {
        const batch = await tx.productionScheduleOrderSupplement.createMany({ data: chunk });
        return batch.count;
      },
      {
        maxWait: REPLACEMENT_TX_MAX_WAIT_MS,
        timeout: REPLACEMENT_TX_TIMEOUT_MS,
      }
    );
    inserted += batchCount;
  }

  for (let i = 0; i < params.updateInputs.length; i += UPDATE_CHUNK_SIZE) {
    const chunk = params.updateInputs.slice(i, i + UPDATE_CHUNK_SIZE);
    await client.$transaction(
      async (tx) => {
        const splitParentIds = await collectSplitParentIdsForSupplementUpdates(tx, chunk);
        for (const entry of chunk) {
          const splitReconcile = await prepareSplitQuantityReconcileForSupplementUpdate(tx, entry, splitParentIds);
          const updateData = splitReconcile?.keepPreviousParent
            ? {
                ...entry.data,
                csvDashboardRowId: entry.previousCsvDashboardRowId,
              }
            : entry.data;
          await tx.productionScheduleOrderSupplement.update({
            where: { id: entry.id },
            data: updateData,
          });
          if (splitReconcile) {
            await reconcileOrderSplitQuantitiesForSupplementUpdate(tx, {
              ...entry,
              csvDashboardRowId: splitReconcile.parentCsvDashboardRowId,
            });
          }
        }
      },
      {
        maxWait: REPLACEMENT_TX_MAX_WAIT_MS,
        timeout: REPLACEMENT_TX_TIMEOUT_MS,
      }
    );
  }

  const pruned = await client.$transaction(
    async (tx) => {
      const pruneResult = await tx.productionScheduleOrderSupplement.deleteMany({
        where: {
          csvDashboardId: PRODUCTION_SCHEDULE_DASHBOARD_ID,
          sourceCsvDashboardId: PRODUCTION_SCHEDULE_ORDER_SUPPLEMENT_DASHBOARD_ID,
          plannedStartDate: { lt: retentionCutoff },
          plannedStartDateManuallySet: false,
        },
      });
      return pruneResult.count;
    },
    {
      maxWait: REPLACEMENT_TX_MAX_WAIT_MS,
      timeout: REPLACEMENT_TX_TIMEOUT_MS,
    }
  );

  return {
    scanned: params.scanned,
    normalized: params.normalized,
    matched: params.matched,
    unmatched: params.unmatched,
    upserted: inserted + params.updateInputs.length,
    pruned,
  };
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
