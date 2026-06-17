/**
 * FKOJUNST_Status Gmail CSV sync: read/normalize → FUPDTEDTで最新化 → winner resolve → delete-by-source + createMany.
 */
import { readFile } from 'node:fs/promises';

import { parse } from 'csv-parse/sync';
import { Prisma, type PrismaClient } from '@prisma/client';

import {
  PRODUCTION_SCHEDULE_DASHBOARD_ID,
  PRODUCTION_SCHEDULE_FKOJUNST_STATUS_MAIL_DASHBOARD_ID,
} from './constants.js';
import { acquireFkojunstStatusMailCriticalTransactionLock } from './fkojunst-status-mail-critical-lock.js';
import { parseFkojunstStatusMailFupdteDt } from '../csv-dashboard/csv-dashboard-datetime-parse.js';
import { findFkojunstMailWinnerIdsByMailTriples } from './fkojunst-mail-winner-by-triple.reader.js';
import { buildFkojunstMailStatusKey } from './fkojunst-mail-status-key.js';
import { normalizeProductionScheduleResourceCd } from './policies/resource-category-policy.service.js';
import {
  fetchFkojunstStatusMailSourceRowsWithGenerationSignals
} from './fkojunst-status-mail-generation-signals.js';

export { buildFkojunstMailStatusKey };

export { parseFkojunstStatusMailFupdteDt };

export {
  fetchFkojunstStatusMailSourceRowsOrdered,
  FKOJUNST_STATUS_MAIL_SOURCE_ROW_ORDER_BY,
  type FkojunstStatusMailSourceRow
} from './fkojunst-status-mail-source-rows.reader.js';

const CREATE_MANY_CHUNK_SIZE = 200;
const REPLACEMENT_TX_TIMEOUT_MS = 60_000;
const REPLACEMENT_TX_MAX_WAIT_MS = 15_000;

const ALLOWED_STATUS = new Set(['C', 'P', 'S', 'R', 'X', 'O']);
const INVALID_STATUS_SENTINEL = '?';
const EMPTY_STATUS_SENTINEL = '';
const UNPARSEABLE_DATE_FALLBACK = new Date('1970-01-01T00:00:00.000Z');

export type FkojunstMailNormalizedRow = {
  sourceRowId: string;
  sourceRowOrdinal?: number | null;
  sourceIngestRunCompletedAt?: Date | null;
  sourceIngestRunStartedAt?: Date | null;
  fkojun: string;
  fkoteicd: string;
  fsezono: string;
  statusCode: string;
  sourceUpdatedAt: Date;
  hasUnparseableDate: boolean;
};

export type FkojunstMailSyncResult = {
  scanned: number;
  normalized: number;
  matched: number;
  unmatched: number;
  skippedInvalidStatus: number;
  skippedUnparseableDate: number;
  upserted: number;
  pruned: number;
};

const normalizeToken = (value: unknown): string => String(value ?? '').trim();

function normalizeStatusCode(value: unknown): string | null {
  const s = normalizeToken(value).toUpperCase();
  if (s.length !== 1) return null;
  return ALLOWED_STATUS.has(s) ? s : null;
}

export function toFkojunstMailNormalizedRow(
  sourceRowId: string,
  rowData: Record<string, unknown>,
  sourceRowOrdinal?: number | null,
  sourceIngestRunStartedAt?: Date | null,
  sourceIngestRunCompletedAt?: Date | null
): { row: FkojunstMailNormalizedRow | null; skippedInvalidStatus: boolean; skippedUnparseableDate: boolean } {
  const fkojun = normalizeToken(rowData.FKOJUN);
  const fkoteicd = normalizeProductionScheduleResourceCd(normalizeToken(rowData.FKOTEICD));
  const fsezono = normalizeToken(rowData.FSEZONO);
  const rawStatus = normalizeToken(rowData.FKOJUNST);
  const statusCode = normalizeStatusCode(rowData.FKOJUNST);
  const sourceUpdatedAt = parseFkojunstStatusMailFupdteDt(rowData.FUPDTEDT);

  let skippedInvalidStatus = false;
  if (rawStatus.length > 0 && statusCode === null) {
    skippedInvalidStatus = true;
  }
  if (fkojun.length === 0 || fkoteicd.length === 0 || fsezono.length === 0) {
    return { row: null, skippedInvalidStatus, skippedUnparseableDate: false };
  }

  const persistedStatusCode =
    statusCode ?? (rawStatus.length === 0 ? EMPTY_STATUS_SENTINEL : INVALID_STATUS_SENTINEL);
  const hasUnparseableDate = sourceUpdatedAt === null;

  return {
    row: {
      sourceRowId,
      sourceRowOrdinal,
      sourceIngestRunCompletedAt,
      sourceIngestRunStartedAt,
      fkojun,
      fkoteicd,
      fsezono,
      statusCode: persistedStatusCode,
      sourceUpdatedAt: sourceUpdatedAt ?? UNPARSEABLE_DATE_FALLBACK,
      hasUnparseableDate,
    },
    skippedInvalidStatus,
    skippedUnparseableDate: hasUnparseableDate,
  };
}

/**
 * 同一キーは FUPDTEDT 最大の行のみ残す。同一 FUPDTEDT は入力順の先勝ち。
 * 不正日付行が関わる場合は FUPDTEDT 比較不能なので、完了済み取り込み世代（completedAt 優先）と sourceRowOrdinal で後続行を現在状態として扱う。
 * 片側だけ世代情報を持つ場合は post-migration の観測行を優先する。両方不明なら安全側で unparseable を優先する。
 */
export function dedupeFkojunstMailRowsByLatest(rows: FkojunstMailNormalizedRow[]): FkojunstMailNormalizedRow[] {
  const rowOrderKey = (row: FkojunstMailNormalizedRow): { generationTime: number; ordinal: number } | null => {
    const generation = row.sourceIngestRunCompletedAt ?? row.sourceIngestRunStartedAt;
    if (generation == null || row.sourceRowOrdinal == null) {
      return null;
    }
    return { generationTime: generation.getTime(), ordinal: row.sourceRowOrdinal };
  };

  const isLaterBySourceOrder = (row: FkojunstMailNormalizedRow, prev: FkojunstMailNormalizedRow): boolean | null => {
    const currentKey = rowOrderKey(row);
    const prevKey = rowOrderKey(prev);
    if (currentKey == null || prevKey == null) {
      if (currentKey != null || prevKey != null) {
        return currentKey != null;
      }
      return null;
    }
    if (currentKey.generationTime !== prevKey.generationTime) {
      return currentKey.generationTime > prevKey.generationTime;
    }
    return currentKey.ordinal > prevKey.ordinal;
  };

  const byKey = new Map<string, FkojunstMailNormalizedRow>();
  for (const row of rows) {
    const key = buildFkojunstMailStatusKey({
      fkojun: row.fkojun,
      fkoteicd: row.fkoteicd,
      fsezono: row.fsezono,
    });
    const prev = byKey.get(key);
    if (!prev) {
      byKey.set(key, row);
      continue;
    }
    if (row.hasUnparseableDate || prev.hasUnparseableDate) {
      const laterBySourceOrder = isLaterBySourceOrder(row, prev);
      if (laterBySourceOrder == null) {
        if (row.hasUnparseableDate && !prev.hasUnparseableDate) {
          byKey.set(key, row);
        }
        continue;
      }
      if (laterBySourceOrder) {
        byKey.set(key, row);
      }
      continue;
    }
    if (!row.hasUnparseableDate && row.sourceUpdatedAt.getTime() > prev.sourceUpdatedAt.getTime()) {
      byKey.set(key, row);
    }
  }
  return [...byKey.values()];
}

/**
 * DBから既に読み出した `FKOJUNST_Status` 行を、メール同期と同じ正規化に通す。
 */
export function collectFkojunstMailNormalizedRowsFromSourceRows(
  sourceRows: ReadonlyArray<{
    id: string;
    rowData: unknown;
    sourceRowOrdinal?: number | null;
    sourceIngestRunStartedAt?: Date | null;
    sourceIngestRunCompletedAt?: Date | null;
  }>
): {
  normalizedRows: FkojunstMailNormalizedRow[];
  skippedInvalidStatus: number;
  skippedUnparseableDate: number;
} {
  let skippedInvalidStatus = 0;
  let skippedUnparseableDate = 0;
  const normalizedRows: FkojunstMailNormalizedRow[] = [];
  for (const row of sourceRows) {
    const rd = row.rowData as Record<string, unknown>;
    const parsed = toFkojunstMailNormalizedRow(
      row.id,
      rd,
      row.sourceRowOrdinal,
      row.sourceIngestRunStartedAt,
      row.sourceIngestRunCompletedAt
    );
    if (parsed.skippedInvalidStatus) skippedInvalidStatus += 1;
    if (parsed.skippedUnparseableDate) skippedUnparseableDate += 1;
    if (parsed.row) {
      normalizedRows.push(parsed.row);
    }
  }
  return { normalizedRows, skippedInvalidStatus, skippedUnparseableDate };
}

/**
 * 原本CSV 1件の行集合を、メール同期と同じ正規化へ通す。
 */
export function collectFkojunstMailNormalizedRowsFromCsvRecords(
  records: ReadonlyArray<Record<string, unknown>>,
  options?: { sourceIngestRunStartedAt?: Date | null; sourceIngestRunCompletedAt?: Date | null }
): {
  normalizedRows: FkojunstMailNormalizedRow[];
  skippedInvalidStatus: number;
  skippedUnparseableDate: number;
} {
  return collectFkojunstMailNormalizedRowsFromSourceRows(
    records.map((rowData, index) => ({
      id: `csv-record-${index}`,
      rowData,
      sourceRowOrdinal: index,
      sourceIngestRunStartedAt: options?.sourceIngestRunStartedAt ?? null,
      sourceIngestRunCompletedAt: options?.sourceIngestRunCompletedAt ?? null
    }))
  );
}

export async function loadFkojunstMailSourceRows(client: PrismaClient): Promise<{
  scanned: number;
  normalizedRows: FkojunstMailNormalizedRow[];
  skippedInvalidStatus: number;
  skippedUnparseableDate: number;
  rowsRevision: string;
}> {
  const { sourceRows, signals } = await fetchFkojunstStatusMailSourceRowsWithGenerationSignals(client);

  const collected = collectFkojunstMailNormalizedRowsFromSourceRows(sourceRows);

  return {
    scanned: sourceRows.length,
    normalizedRows: collected.normalizedRows,
    skippedInvalidStatus: collected.skippedInvalidStatus,
    skippedUnparseableDate: collected.skippedUnparseableDate,
    rowsRevision: signals.rowsRevision
  };
}

/**
 * 1回の `FKOJUNST_Status` ingest run が保存した原本CSVを読み、同 run のスナップショットだけを正規化する。
 */
export async function loadFkojunstMailNormalizedRowsFromCsvFile(params: {
  csvFilePath: string;
  sourceIngestRunStartedAt?: Date | null;
  sourceIngestRunCompletedAt?: Date | null;
}): Promise<{
  scanned: number;
  normalizedRows: FkojunstMailNormalizedRow[];
  skippedInvalidStatus: number;
  skippedUnparseableDate: number;
}> {
  const csvText = await readFile(params.csvFilePath, 'utf-8');
  const records = parse(csvText, {
    bom: true,
    columns: true,
    skip_empty_lines: true,
    relax_column_count: true,
    trim: false,
  }) as Array<Record<string, unknown>>;

  const collected = collectFkojunstMailNormalizedRowsFromCsvRecords(records, {
    sourceIngestRunStartedAt: params.sourceIngestRunStartedAt ?? null,
    sourceIngestRunCompletedAt: params.sourceIngestRunCompletedAt ?? null
  });

  return {
    scanned: records.length,
    normalizedRows: collected.normalizedRows,
    skippedInvalidStatus: collected.skippedInvalidStatus,
    skippedUnparseableDate: collected.skippedUnparseableDate,
  };
}

export async function resolveFkojunstMailWinnerIdByKey(
  client: PrismaClient,
  dedupedRows: FkojunstMailNormalizedRow[]
): Promise<Map<string, string>> {
  if (dedupedRows.length === 0) {
    return new Map();
  }
  return findFkojunstMailWinnerIdsByMailTriples({
    client,
    productionScheduleDashboardId: PRODUCTION_SCHEDULE_DASHBOARD_ID,
    triples: dedupedRows.map((row) => ({
      fkojun: row.fkojun,
      fkoteicd: row.fkoteicd,
      fsezono: row.fsezono,
    })),
  });
}

export function buildFkojunstMailReplacementCreateInputs(
  dedupedRows: FkojunstMailNormalizedRow[],
  winnerIdByKey: Map<string, string>
): {
  matched: number;
  unmatched: number;
  createInputs: Prisma.ProductionScheduleFkojunstMailStatusCreateManyInput[];
} {
  let matched = 0;
  let unmatched = 0;
  const createInputs: Prisma.ProductionScheduleFkojunstMailStatusCreateManyInput[] = [];

  for (const row of dedupedRows) {
    const key = buildFkojunstMailStatusKey({
      fkojun: row.fkojun,
      fkoteicd: row.fkoteicd,
      fsezono: row.fsezono,
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
      sourceCsvDashboardId: PRODUCTION_SCHEDULE_FKOJUNST_STATUS_MAIL_DASHBOARD_ID,
      fkojun: row.fkojun,
      fkoteicd: row.fkoteicd,
      fsezono: row.fsezono,
      statusCode: row.statusCode,
      sourceUpdatedAt: row.sourceUpdatedAt,
    });
  }

  return { matched, unmatched, createInputs };
}

export async function runFkojunstMailReplacementTransaction(
  client: PrismaClient,
  params: {
    scanned: number;
    normalized: number;
    matched: number;
    unmatched: number;
    skippedInvalidStatus: number;
    skippedUnparseableDate: number;
    createInputs: Prisma.ProductionScheduleFkojunstMailStatusCreateManyInput[];
    sourceRowsRevision?: string;
  }
): Promise<FkojunstMailSyncResult> {
  return client.$transaction(
    async (tx) => {
      await acquireFkojunstStatusMailCriticalTransactionLock(tx);
      if (params.sourceRowsRevision != null) {
        const { signals } = await fetchFkojunstStatusMailSourceRowsWithGenerationSignals(tx);
        if (signals.rowsRevision !== params.sourceRowsRevision) {
          throw new Error(
            `[FkojunstMailSync] raw source revision changed during sync: expected ${params.sourceRowsRevision}, got ${signals.rowsRevision}`
          );
        }
      }

      const pruneResult = await tx.productionScheduleFkojunstMailStatus.deleteMany({
        where: {
          csvDashboardId: PRODUCTION_SCHEDULE_DASHBOARD_ID,
          sourceCsvDashboardId: PRODUCTION_SCHEDULE_FKOJUNST_STATUS_MAIL_DASHBOARD_ID,
        },
      });

      let inserted = 0;
      for (let i = 0; i < params.createInputs.length; i += CREATE_MANY_CHUNK_SIZE) {
        const chunk = params.createInputs.slice(i, i + CREATE_MANY_CHUNK_SIZE);
        if (chunk.length === 0) continue;
        const batch = await tx.productionScheduleFkojunstMailStatus.createMany({ data: chunk });
        inserted += batch.count;
      }

      if (inserted !== params.createInputs.length) {
        throw new Error(
          `[FkojunstMailSync] insert count mismatch: expected ${params.createInputs.length}, got ${inserted}`
        );
      }

      return {
        scanned: params.scanned,
        normalized: params.normalized,
        matched: params.matched,
        unmatched: params.unmatched,
        skippedInvalidStatus: params.skippedInvalidStatus,
        skippedUnparseableDate: params.skippedUnparseableDate,
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

export async function runFkojunstMailClearTransaction(
  client: PrismaClient,
  scanned: number,
  skippedInvalidStatus: number,
  skippedUnparseableDate: number,
  sourceRowsRevision?: string
): Promise<FkojunstMailSyncResult> {
  return client.$transaction(
    async (tx) => {
      await acquireFkojunstStatusMailCriticalTransactionLock(tx);
      if (sourceRowsRevision != null) {
        const { signals } = await fetchFkojunstStatusMailSourceRowsWithGenerationSignals(tx);
        if (signals.rowsRevision !== sourceRowsRevision) {
          throw new Error(
            `[FkojunstMailSync] raw source revision changed during clear: expected ${sourceRowsRevision}, got ${signals.rowsRevision}`
          );
        }
      }

      const pruneResult = await tx.productionScheduleFkojunstMailStatus.deleteMany({
        where: {
          csvDashboardId: PRODUCTION_SCHEDULE_DASHBOARD_ID,
          sourceCsvDashboardId: PRODUCTION_SCHEDULE_FKOJUNST_STATUS_MAIL_DASHBOARD_ID,
        },
      });
      return {
        scanned,
        normalized: 0,
        matched: 0,
        unmatched: 0,
        skippedInvalidStatus,
        skippedUnparseableDate,
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
