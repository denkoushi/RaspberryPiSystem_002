import { readLaterPieceAuditSnapshots, collectLaterPiecePropagationAudits, writeLaterPiecePropagationAudits, type PieceAuditContext } from './sessaku-pieces/piece-audit.js';
import { encodeSessakuPieceKey, sessakuPieceKeyFromRow } from './sessaku-pieces/piece-key.js';
import { assertSessakuPieceWinnerTargets, lockSessakuPieceSourceRows, synchronizeSessakuPieceSources } from './sessaku-pieces/piece-sync.js';
/**
 * Production schedule order supplement sync: read/normalize → plan → short DB write.
 * DB write uses incremental create/update + retention prune.
 */
import { Prisma, type PrismaClient } from '@prisma/client';

import { toTrimmedString as normalizeToken } from '../../lib/string-normalize.js';
import {
  PRODUCTION_SCHEDULE_DASHBOARD_ID,
  PRODUCTION_SCHEDULE_ORDER_SUPPLEMENT_DASHBOARD_ID,
} from './constants.js';
import { normalizeProductionScheduleResourceCd } from './policies/resource-category-policy.service.js';
import {
  buildMaxProductNoLogicalKeyPartitionExprs,
  buildMaxProductNoWinnerSelectionOrderBySql,
} from './row-resolver/index.js';

const CREATE_MANY_CHUNK_SIZE = 200;
const UPDATE_CHUNK_SIZE = 100;
/** Interactive transaction: avoid default ~5s cap on slow hosts / large CSVs */
const REPLACEMENT_TX_TIMEOUT_MS = 60_000;
const REPLACEMENT_TX_MAX_WAIT_MS = 15_000;
const RETENTION_YEARS = 1;
const SOURCE_RETENTION_DELETE_CHUNK_SIZE = 2_000;

export type SupplementNormalizedRow = {
  piecePlannedQuantity?: number | null;
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
  const parsed = Number.parseInt(normalized, 10);
  return parsed > 0 ? parsed : null;
};

const mergePlannedQuantityForUpdate = (fromCsv: number | null, existing: number | null): number | null =>
  fromCsv ?? existing;

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
    piecePlannedQuantity: (() => {
      const raw = firstNonBlankToken(rowData.plannedQuantity, rowData.FKOJUNSIJISU);
      const quantity = Number(raw);
      return /^\d+$/.test(raw) && Number.isSafeInteger(quantity) && quantity <= 2_147_483_647 ? quantity : null;
    })(),
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
  const logicalKeyPartitionExprs = buildMaxProductNoLogicalKeyPartitionExprs('schedule_row');
  const winnerOrderBy = buildMaxProductNoWinnerSelectionOrderBySql('schedule_row');

  const winnerRows = await client.$queryRaw<WinnerKeyRow[]>(Prisma.sql`
    WITH input_keys AS MATERIALIZED (
      SELECT DISTINCT
        "productNo",
        "resourceCd",
        "processOrder"
      FROM jsonb_to_recordset(CAST(${lookupKeysJson} AS jsonb)) AS key(
        "productNo" text,
        "resourceCd" text,
        "processOrder" text
      )
    ),
    ranked_schedule AS MATERIALIZED (
      SELECT
        "schedule_row"."id" AS "id",
        NULLIF(BTRIM("schedule_row"."rowData"->>'ProductNo'), '') AS "productNo",
        UPPER(BTRIM("schedule_row"."rowData"->>'FSIGENCD')) AS "resourceCd",
        NULLIF(BTRIM("schedule_row"."rowData"->>'FKOJUN'), '') AS "processOrder",
        ROW_NUMBER() OVER (
          PARTITION BY ${Prisma.raw(logicalKeyPartitionExprs)}
          ORDER BY ${Prisma.raw(winnerOrderBy)}
        ) AS "winnerRank"
      FROM "CsvDashboardRow" AS "schedule_row"
      WHERE "schedule_row"."csvDashboardId" = ${PRODUCTION_SCHEDULE_DASHBOARD_ID}
    )
    SELECT
      ranked_schedule."id",
      ranked_schedule."productNo",
      ranked_schedule."resourceCd",
      ranked_schedule."processOrder"
    FROM ranked_schedule
    INNER JOIN input_keys
      ON input_keys."productNo" = ranked_schedule."productNo"
      AND input_keys."resourceCd" = ranked_schedule."resourceCd"
      AND input_keys."processOrder" = ranked_schedule."processOrder"
    WHERE ranked_schedule."winnerRank" = 1
  `);

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

/**
 * Bounds the accumulated DEDUP source rows without removing usable work.
 *
 * The source dashboard has no date column, so `occurredAt` is the import time
 * and cannot express the business retention period. Prefer the planned end
 * date (then planned start date), and only expire a row when its exact key no
 * longer has a current production-schedule winner. This keeps long-running
 * current work, future work, and rows whose business date is unknown.
 */
export function collectExpiredUnmatchedSupplementSourceRowIds(params: {
  normalizedRows: SupplementNormalizedRow[];
  winnerIdByKey: ReadonlyMap<string, string>;
  now: Date;
}): string[] {
  const retentionCutoff = new Date(params.now);
  retentionCutoff.setUTCFullYear(retentionCutoff.getUTCFullYear() - RETENTION_YEARS);

  return params.normalizedRows.flatMap((row) => {
    const retentionBasis = row.plannedEndDate ?? row.plannedStartDate;
    if (!retentionBasis || retentionBasis >= retentionCutoff) {
      return [];
    }
    const key = buildOrderSupplementKey({
      productNo: row.productNo,
      resourceCd: row.resourceCd,
      processOrder: row.processOrder,
    });
    return params.winnerIdByKey.has(key) ? [] : [row.sourceRowId];
  });
}

export async function deleteExpiredUnmatchedSupplementSourceRows(
  client: PrismaClient,
  sourceRowIds: string[]
): Promise<number> {
  let deletedCount = 0;
  for (let i = 0; i < sourceRowIds.length; i += SOURCE_RETENTION_DELETE_CHUNK_SIZE) {
    const ids = sourceRowIds.slice(i, i + SOURCE_RETENTION_DELETE_CHUNK_SIZE);
    if (ids.length === 0) continue;
    const deleted = await client.csvDashboardRow.deleteMany({
      where: {
        id: { in: ids },
        csvDashboardId: PRODUCTION_SCHEDULE_ORDER_SUPPLEMENT_DASHBOARD_ID,
      },
    });
    deletedCount += deleted.count;
  }
  return deletedCount;
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
  pieceQuantityByRowId: Map<string, number | null>;
} {
  let matched = 0;
  let unmatched = 0;
  const pieceQuantityByRowId = new Map<string, number | null>();
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
    pieceQuantityByRowId.set(winnerRowId, row.piecePlannedQuantity === undefined ? row.plannedQuantity : row.piecePlannedQuantity);
    const existing = existingByKey.get(key);
    const existingByWinner = existingByWinnerRowId.get(winnerRowId);
    const existingTarget = existing ?? existingByWinner;
    if (existingTarget) {
      const nextPlannedQuantity = mergePlannedQuantityForUpdate(row.plannedQuantity, existingTarget.plannedQuantity);
      const nextPlannedStartDate = existingTarget.plannedStartDateManuallySet
        ? existingTarget.plannedStartDate
        : row.plannedStartDate ?? existingTarget.plannedStartDate;
      const nextPlannedEndDate = mergePlannedEndDateForUpdate(row.plannedEndDate, existingTarget.plannedEndDate);
      updateInputs.push({
        id: existingTarget.id,
        data: {
          csvDashboardRowId: winnerRowId,
          productNo: row.productNo,
          resourceCd: row.resourceCd,
          processOrder: row.processOrder,
          plannedQuantity: nextPlannedQuantity,
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

  return { matched, unmatched, createInputs, updateInputs, pieceQuantityByRowId };
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
    pieceQuantityByRowId?: ReadonlyMap<string, number | null>;
  }
): Promise<OrderSupplementSyncResult> {
  const retentionCutoff = new Date();
  retentionCutoff.setUTCFullYear(retentionCutoff.getUTCFullYear() - RETENTION_YEARS);

  const propagationAudits: PieceAuditContext[] = [];
  try {
    let inserted = 0;
    for (let i = 0; i < params.createInputs.length; i += CREATE_MANY_CHUNK_SIZE) {
      const chunk = params.createInputs.slice(i, i + CREATE_MANY_CHUNK_SIZE);
      if (chunk.length === 0) continue;
      const committed = await client.$transaction(
        async (tx) => {
          const keys = await lockSessakuPieceSourceRows(tx, chunk.map((entry) => entry.csvDashboardRowId));
          if (keys.length) await assertSessakuPieceWinnerTargets(tx, chunk.map((entry) => entry.csvDashboardRowId));
          const rows = keys.length ? await tx.csvDashboardRow.findMany({ where: { id: { in: chunk.map((entry) => entry.csvDashboardRowId) } }, select: { id: true, rowData: true } }) : [];
          const partKeys = [...new Map(rows.map((row) => { const { fseiban, fhincd } = sessakuPieceKeyFromRow(row.rowData); return [JSON.stringify([fseiban, fhincd]), { fseiban, fhincd }]; })).values()];
          const relatedSets = partKeys.length ? await tx.productionScheduleSessakuPieceSet.findMany({ where: { csvDashboardId: PRODUCTION_SCHEDULE_DASHBOARD_ID, OR: partKeys }, include: { pieces: true } }) : [];
          const sets = new Map(relatedSets.map((set) => [encodeSessakuPieceKey(set), set]));
          const partsWithSets = new Set(relatedSets.filter((set) => set.pieces.length || set.sourcePieceSetId).map(({ fseiban, fhincd }) => JSON.stringify([fseiban, fhincd])));
          const rowsWithSets = new Set(rows.filter((row) => {
            const key = sessakuPieceKeyFromRow(row.rowData);
            const ownSet = sets.get(encodeSessakuPieceKey(key));
            if (ownSet && !ownSet.pieces.length && !ownSet.sourcePieceSetId) return false;
            return partsWithSets.has(JSON.stringify([key.fseiban, key.fhincd]));
          }).map((row) => row.id));
          const liveRowIds = new Set(rows.filter((row) => (sets.get(encodeSessakuPieceKey(sessakuPieceKeyFromRow(row.rowData)))?.pieces.length || sets.get(encodeSessakuPieceKey(sessakuPieceKeyFromRow(row.rowData)))?.sourcePieceSetId)).map((row) => row.id));
          const before = await readLaterPieceAuditSnapshots(tx, keys);
          const data = [];
          for (const entry of chunk) {
            if (!keys.length) { data.push(entry); continue; }
            data.push((liveRowIds.has(entry.csvDashboardRowId) || rowsWithSets.has(entry.csvDashboardRowId) && params.pieceQuantityByRowId?.get(entry.csvDashboardRowId) === 0) && params.pieceQuantityByRowId?.has(entry.csvDashboardRowId) ? { ...entry, plannedQuantity: params.pieceQuantityByRowId.get(entry.csvDashboardRowId) } : entry);
          }
          const batch = await tx.productionScheduleOrderSupplement.createMany({ data });
          await synchronizeSessakuPieceSources(tx, keys);
          return { count: batch.count, audits: collectLaterPiecePropagationAudits(before, await readLaterPieceAuditSnapshots(tx, keys, before), '__shared__') };
        },
        {
          maxWait: REPLACEMENT_TX_MAX_WAIT_MS,
          timeout: REPLACEMENT_TX_TIMEOUT_MS,
        }
      );
      inserted += committed.count;
      propagationAudits.push(...committed.audits);
    }

    for (let i = 0; i < params.updateInputs.length; i += UPDATE_CHUNK_SIZE) {
      const chunk = params.updateInputs.slice(i, i + UPDATE_CHUNK_SIZE);
      const audits = await client.$transaction(
        async (tx) => {
          const previous = await tx.productionScheduleOrderSupplement.findMany({ where: { id: { in: chunk.map((entry) => entry.id) } }, select: { id: true, csvDashboardRowId: true } });
          const nextRowIds = chunk.flatMap((entry) => typeof entry.data.csvDashboardRowId === 'string' ? [entry.data.csvDashboardRowId] : []);
          const keys = await lockSessakuPieceSourceRows(tx, [...previous.map((entry) => entry.csvDashboardRowId), ...nextRowIds]);
          if (keys.length) await assertSessakuPieceWinnerTargets(tx, nextRowIds);
          const targetIds = [...previous.map((entry) => entry.csvDashboardRowId), ...nextRowIds];
          const rows = keys.length ? await tx.csvDashboardRow.findMany({ where: { id: { in: targetIds } }, select: { id: true, rowData: true } }) : [];
          const partKeys = [...new Map(rows.map((row) => { const { fseiban, fhincd } = sessakuPieceKeyFromRow(row.rowData); return [JSON.stringify([fseiban, fhincd]), { fseiban, fhincd }]; })).values()];
          const relatedSets = partKeys.length ? await tx.productionScheduleSessakuPieceSet.findMany({ where: { csvDashboardId: PRODUCTION_SCHEDULE_DASHBOARD_ID, OR: partKeys }, include: { pieces: true } }) : [];
          const sets = new Map(relatedSets.map((set) => [encodeSessakuPieceKey(set), set]));
          const partsWithSets = new Set(relatedSets.filter((set) => set.pieces.length || set.sourcePieceSetId).map(({ fseiban, fhincd }) => JSON.stringify([fseiban, fhincd])));
          const rowsWithSets = new Set(rows.filter((row) => {
            const key = sessakuPieceKeyFromRow(row.rowData);
            const ownSet = sets.get(encodeSessakuPieceKey(key));
            if (ownSet && !ownSet.pieces.length && !ownSet.sourcePieceSetId) return false;
            return partsWithSets.has(JSON.stringify([key.fseiban, key.fhincd]));
          }).map((row) => row.id));
          const liveRowIds = new Set(rows.filter((row) => (sets.get(encodeSessakuPieceKey(sessakuPieceKeyFromRow(row.rowData)))?.pieces.length || sets.get(encodeSessakuPieceKey(sessakuPieceKeyFromRow(row.rowData)))?.sourcePieceSetId)).map((row) => row.id));
          const before = await readLaterPieceAuditSnapshots(tx, keys);
          for (const entry of chunk) {
            const targetRowId = !keys.length ? undefined : typeof entry.data.csvDashboardRowId === 'string' ? entry.data.csvDashboardRowId : previous.find((p) => p.id === entry.id)?.csvDashboardRowId;
            await tx.productionScheduleOrderSupplement.update({
              where: { id: entry.id },
              data: targetRowId && (liveRowIds.has(targetRowId) || rowsWithSets.has(targetRowId) && params.pieceQuantityByRowId?.get(targetRowId) === 0) && params.pieceQuantityByRowId?.has(targetRowId) ? { ...entry.data, plannedQuantity: params.pieceQuantityByRowId.get(targetRowId) } : entry.data,
            });
          }
          await synchronizeSessakuPieceSources(tx, keys);
          return collectLaterPiecePropagationAudits(before, await readLaterPieceAuditSnapshots(tx, keys, before), '__shared__');
        },
        {
          maxWait: REPLACEMENT_TX_MAX_WAIT_MS,
          timeout: REPLACEMENT_TX_TIMEOUT_MS,
        }
      );
      propagationAudits.push(...audits);
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
  } finally {
    await writeLaterPiecePropagationAudits(propagationAudits);
  }
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
