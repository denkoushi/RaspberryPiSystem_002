import { replaceMissingStandardHoursProcesses } from './missing-standard-hours-process.js';
import { replaceAllWinnerExternalCompletionStatesFromMailSync } from './external-completion/fkojunst-external-completion-sync.repository.js';
/**
 * FKOJUNST_Status Gmail CSV sync: read/normalize → FUPDTEDTで最新化 → winner resolve → delete-by-source + createMany.
 */
import { readFile } from 'node:fs/promises';

import { parse } from 'csv-parse/sync';
import { Prisma, type PrismaClient } from '@prisma/client';

import { toTrimmedString as normalizeToken } from '../../lib/string-normalize.js';
import {
  PRODUCTION_SCHEDULE_DASHBOARD_ID,
  PRODUCTION_SCHEDULE_FKOJUNST_STATUS_MAIL_DASHBOARD_ID,
} from './constants.js';
import { acquireFkojunstStatusMailCriticalTransactionLock } from './fkojunst-status-mail-critical-lock.js';
import { parseFkojunstStatusMailFupdteDt } from '../csv-dashboard/csv-dashboard-datetime-parse.js';
import { buildFkojunstWinnerProcessKey, findFkojunstMailWinnerIdsByMailTriples } from './fkojunst-mail-winner-by-triple.reader.js';
import { buildFkojunstMailStatusKey } from './fkojunst-mail-status-key.js';
import { normalizeProductionScheduleResourceCd } from './policies/resource-category-policy.service.js';
import {
  fetchFkojunstStatusMailGenerationSignals,
  fetchFkojunstStatusMailSourceRowsWithGenerationSignals
} from './fkojunst-status-mail-generation-signals.js';
import { PROCESS_CHANGE_RESIDUAL_EVIDENCE_ALGORITHM_VERSION } from './leaderboard/leaderboard-process-change-residual.version.js';
import type { FkojunstMailNormalizedRow } from './fkojunst-mail-row.types.js';

export { buildFkojunstMailStatusKey };

export { parseFkojunstStatusMailFupdteDt };

export {
  fetchFkojunstStatusMailSourceRowsOrdered,
  FKOJUNST_STATUS_MAIL_SOURCE_ROW_ORDER_BY,
  type FkojunstStatusMailSourceRow
} from './fkojunst-status-mail-source-rows.reader.js';

const CREATE_MANY_CHUNK_SIZE = 200;
const PROCESS_CHANGE_RESIDUAL_EVIDENCE_CREATE_MANY_CHUNK_SIZE = 200;
// Pi5で約8万行の世代確認と全件置換が60秒を超えるため、同一原子処理の上限を確保する。
const REPLACEMENT_TX_TIMEOUT_MS = 300_000;
const REPLACEMENT_TX_MAX_WAIT_MS = 15_000;

const ALLOWED_STATUS = new Set(['C', 'P', 'S', 'R', 'X', 'O']);
const INVALID_STATUS_SENTINEL = '?';
const EMPTY_STATUS_SENTINEL = '';
const UNPARSEABLE_DATE_FALLBACK = new Date('1970-01-01T00:00:00.000Z');

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

async function resolveFkojunstMailWinnerIdByKey(
  client: Pick<Prisma.TransactionClient, '$queryRaw'>,
  dedupedRows: readonly FkojunstMailNormalizedRow[],
  winnerProcessKeys?: Set<string>
): Promise<Map<string, string>> {
  if (dedupedRows.length === 0) {
    return new Map();
  }
  return findFkojunstMailWinnerIdsByMailTriples({
    client,
    winnerProcessKeys,
    productionScheduleDashboardId: PRODUCTION_SCHEDULE_DASHBOARD_ID,
    triples: dedupedRows.map((row) => ({
      fkojun: row.fkojun,
      fkoteicd: row.fkoteicd,
      fsezono: row.fsezono,
    })),
  });
}

export function buildFkojunstMailReplacementCreateInputs(
  dedupedRows: readonly FkojunstMailNormalizedRow[],
  winnerIdByKey: Map<string, string>,
  winnerProcessKeys?: ReadonlySet<string>
): {
  matched: number;
  unmatched: number;
  createInputs: Prisma.ProductionScheduleFkojunstMailStatusCreateManyInput[];
  resourceSwapEvidenceInputs: Prisma.ProductionScheduleFkojunstResourceSwapEvidenceCreateManyInput[];
} {
  const createInputs: Prisma.ProductionScheduleFkojunstMailStatusCreateManyInput[] = [];
  const resourceSwapEvidenceInputs: Prisma.ProductionScheduleFkojunstResourceSwapEvidenceCreateManyInput[] = [];

  for (const row of dedupedRows) {
    const key = buildFkojunstMailStatusKey({
      fkojun: row.fkojun,
      fkoteicd: row.fkoteicd,
      fsezono: row.fsezono,
    });
    const winnerRowId = winnerIdByKey.get(key);
    if (!winnerRowId) {
      // 状態 CSV は履歴を含めて約92万の組がある(2026-11-25 本番)。winner の無い工程は判定に使わないので残さない。
      if (winnerProcessKeys && !winnerProcessKeys.has(buildFkojunstWinnerProcessKey(row.fsezono, row.fkojun))) continue;
      resourceSwapEvidenceInputs.push({
        sourceCsvDashboardId: PRODUCTION_SCHEDULE_FKOJUNST_STATUS_MAIL_DASHBOARD_ID,
        productNo: row.fsezono,
        fkojun: row.fkojun,
        resourceCd: row.fkoteicd,
        statusCode: row.statusCode,
        sourceUpdatedAt: row.hasUnparseableDate ? null : row.sourceUpdatedAt,
      });
      continue;
    }
    createInputs.push({
      csvDashboardId: PRODUCTION_SCHEDULE_DASHBOARD_ID,
      csvDashboardRowId: winnerRowId,
      sourceCsvDashboardId: PRODUCTION_SCHEDULE_FKOJUNST_STATUS_MAIL_DASHBOARD_ID,
      fkojun: row.fkojun,
      fkoteicd: row.fkoteicd,
      fsezono: row.fsezono,
      statusCode: row.statusCode,
      sourceUpdatedAt: row.sourceUpdatedAt,
      hasUnparseableDate: row.hasUnparseableDate,
    });
  }

  return { matched: createInputs.length, unmatched: resourceSwapEvidenceInputs.length, createInputs, resourceSwapEvidenceInputs };
}

/** The caller holds the mail lock. Reclassify the same snapshot against the current winners. */
export async function replaceFkojunstMailProjections(
  tx: Prisma.TransactionClient,
  dedupedRows: readonly FkojunstMailNormalizedRow[],
  onlyChanged = false
) {
  const winnerProcessKeys = new Set<string>();
  const winnerIdByKey = await resolveFkojunstMailWinnerIdByKey(tx, dedupedRows, winnerProcessKeys);
  const { matched, createInputs, resourceSwapEvidenceInputs } =
    buildFkojunstMailReplacementCreateInputs(dedupedRows, winnerIdByKey, winnerProcessKeys);
  const unmatched = dedupedRows.length - matched;
  const sourceCsvDashboardId = PRODUCTION_SCHEDULE_FKOJUNST_STATUS_MAIL_DASHBOARD_ID;
  const mailSource = { csvDashboardId: PRODUCTION_SCHEDULE_DASHBOARD_ID, sourceCsvDashboardId };
  let evidenceToCreate = resourceSwapEvidenceInputs;
  let mailToCreate = createInputs;
  let prunedEvidence = 0;
  let pruned = 0;
  if (onlyChanged) {
    // Schedule imports can change the match without changing the mail snapshot.
    // Keep the existing projection rows whose key, status and destination still match.
    const evidenceKey = (row: { productNo: string; fkojun: string; resourceCd: string }) =>
      buildFkojunstMailStatusKey({ fsezono: row.productNo, fkojun: row.fkojun, fkoteicd: row.resourceCd });
    const currentEvidence = new Map((await tx.productionScheduleFkojunstResourceSwapEvidence.findMany({
      where: { sourceCsvDashboardId },
    })).map((row) => [evidenceKey(row), row]));
    evidenceToCreate = resourceSwapEvidenceInputs.filter((input) => {
      const key = evidenceKey(input);
      const existing = currentEvidence.get(key);
      const updatedAt = input.sourceUpdatedAt == null ? undefined : new Date(input.sourceUpdatedAt).getTime();
      if (!existing || existing.statusCode !== input.statusCode || existing.sourceUpdatedAt?.getTime() !== updatedAt) return true;
      currentEvidence.delete(key);
      return false;
    });
    const removedEvidence = [...currentEvidence.values()].map(({ productNo, fkojun, resourceCd }) => ({ productNo, fkojun, resourceCd }));
    for (let i = 0; i < removedEvidence.length; i += CREATE_MANY_CHUNK_SIZE) {
      prunedEvidence += (await tx.productionScheduleFkojunstResourceSwapEvidence.deleteMany({
        where: { sourceCsvDashboardId, OR: removedEvidence.slice(i, i + CREATE_MANY_CHUNK_SIZE) },
      })).count;
    }

    const currentMail = new Map((await tx.productionScheduleFkojunstMailStatus.findMany({
      where: mailSource,
      select: {
        csvDashboardRowId: true, fsezono: true, fkojun: true, fkoteicd: true,
        statusCode: true, sourceUpdatedAt: true, hasUnparseableDate: true,
      },
    })).map((row) => [row.csvDashboardRowId, row]));
    mailToCreate = createInputs.filter((input) => {
      const existing = currentMail.get(input.csvDashboardRowId);
      if (!existing || existing.fsezono !== input.fsezono || existing.fkojun !== input.fkojun
        || existing.fkoteicd !== input.fkoteicd || existing.statusCode !== input.statusCode
        || existing.hasUnparseableDate !== input.hasUnparseableDate
        || existing.sourceUpdatedAt.getTime() !== new Date(input.sourceUpdatedAt).getTime()) return true;
      currentMail.delete(input.csvDashboardRowId);
      return false;
    });
    const removedMail = [...currentMail.keys()];
    for (let i = 0; i < removedMail.length; i += CREATE_MANY_CHUNK_SIZE) {
      pruned += (await tx.productionScheduleFkojunstMailStatus.deleteMany({
        where: { ...mailSource, csvDashboardRowId: { in: removedMail.slice(i, i + CREATE_MANY_CHUNK_SIZE) } },
      })).count;
    }
  } else {
    prunedEvidence = (await tx.productionScheduleFkojunstResourceSwapEvidence.deleteMany({ where: { sourceCsvDashboardId } })).count;
    pruned = (await tx.productionScheduleFkojunstMailStatus.deleteMany({ where: mailSource })).count;
  }

  for (let i = 0; i < evidenceToCreate.length; i += CREATE_MANY_CHUNK_SIZE) {
    await tx.productionScheduleFkojunstResourceSwapEvidence.createMany({
      data: evidenceToCreate.slice(i, i + CREATE_MANY_CHUNK_SIZE),
    });
  }
  let inserted = 0;
  for (let i = 0; i < mailToCreate.length; i += CREATE_MANY_CHUNK_SIZE) {
    const batch = await tx.productionScheduleFkojunstMailStatus.createMany({
      data: mailToCreate.slice(i, i + CREATE_MANY_CHUNK_SIZE),
    });
    inserted += batch.count;
  }
  if (inserted !== mailToCreate.length) {
    throw new Error(`[FkojunstMailSync] insert count mismatch: expected ${mailToCreate.length}, got ${inserted}`);
  }
  return { matched, unmatched, upserted: inserted, pruned, prunedEvidence };
}

async function replaceProcessChangeResidualEvidenceSnapshot(
  tx: Prisma.TransactionClient,
  params: {
    sourceRowsRevision: string;
    evidenceInputs: Prisma.ProductionScheduleProcessChangeResidualEvidenceCreateManyInput[];
  }
): Promise<void> {
  await tx.productionScheduleProcessChangeResidualEvidence.deleteMany({
    where: {
      sourceCsvDashboardId: PRODUCTION_SCHEDULE_FKOJUNST_STATUS_MAIL_DASHBOARD_ID,
    },
  });

  await tx.productionScheduleProcessChangeResidualSnapshot.upsert({
    where: {
      sourceCsvDashboardId: PRODUCTION_SCHEDULE_FKOJUNST_STATUS_MAIL_DASHBOARD_ID,
    },
    update: {
      rawMailRowsRevision: params.sourceRowsRevision,
      algorithmVersion: PROCESS_CHANGE_RESIDUAL_EVIDENCE_ALGORITHM_VERSION,
      evidenceCount: params.evidenceInputs.length,
    },
    create: {
      sourceCsvDashboardId: PRODUCTION_SCHEDULE_FKOJUNST_STATUS_MAIL_DASHBOARD_ID,
      rawMailRowsRevision: params.sourceRowsRevision,
      algorithmVersion: PROCESS_CHANGE_RESIDUAL_EVIDENCE_ALGORITHM_VERSION,
      evidenceCount: params.evidenceInputs.length,
    },
  });

  for (let i = 0; i < params.evidenceInputs.length; i += PROCESS_CHANGE_RESIDUAL_EVIDENCE_CREATE_MANY_CHUNK_SIZE) {
    const chunk = params.evidenceInputs.slice(i, i + PROCESS_CHANGE_RESIDUAL_EVIDENCE_CREATE_MANY_CHUNK_SIZE);
    if (chunk.length === 0) continue;
    await tx.productionScheduleProcessChangeResidualEvidence.createMany({ data: chunk });
  }
}

export async function runFkojunstMailReplacementTransaction(
  client: PrismaClient,
  params: {
    scanned: number;
    dedupedRows: readonly FkojunstMailNormalizedRow[];
    skippedInvalidStatus: number;
    skippedUnparseableDate: number;
    processChangeResidualEvidenceInputs?: Prisma.ProductionScheduleProcessChangeResidualEvidenceCreateManyInput[];
    sourceRowsRevision?: string;
  }
): Promise<FkojunstMailSyncResult & { externalCompletionSynced?: true }> {
  return client.$transaction(
    async (tx) => {
      await acquireFkojunstStatusMailCriticalTransactionLock(tx);
      if (params.sourceRowsRevision != null) {
        const signals = await fetchFkojunstStatusMailGenerationSignals(tx);
        if (signals.rowsRevision !== params.sourceRowsRevision) {
          throw new Error(
            `[FkojunstMailSync] raw source revision changed during sync: expected ${params.sourceRowsRevision}, got ${signals.rowsRevision}`
          );
        }
      }

      if (params.sourceRowsRevision != null) {
        await replaceProcessChangeResidualEvidenceSnapshot(tx, {
          sourceRowsRevision: params.sourceRowsRevision,
          evidenceInputs: params.processChangeResidualEvidenceInputs ?? [],
        });
      }

      await replaceMissingStandardHoursProcesses(tx, params.dedupedRows);
      const { matched, unmatched, upserted, pruned } = await replaceFkojunstMailProjections(tx, params.dedupedRows);

      const hasPieces = params.dedupedRows.length > 0 && await tx.productionScheduleSessakuPieceSet.findFirst({
        where: { csvDashboardId: PRODUCTION_SCHEDULE_DASHBOARD_ID, pieces: { some: {} } }, select: { id: true }
      });
      if (hasPieces) await replaceAllWinnerExternalCompletionStatesFromMailSync(tx, true);
      return {
        ...(hasPieces ? { externalCompletionSynced: true as const } : {}),
        scanned: params.scanned,
        normalized: params.dedupedRows.length,
        matched,
        unmatched,
        skippedInvalidStatus: params.skippedInvalidStatus,
        skippedUnparseableDate: params.skippedUnparseableDate,
        upserted,
        pruned,
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
        const signals = await fetchFkojunstStatusMailGenerationSignals(tx);
        if (signals.rowsRevision !== sourceRowsRevision) {
          throw new Error(
            `[FkojunstMailSync] raw source revision changed during clear: expected ${sourceRowsRevision}, got ${signals.rowsRevision}`
          );
        }
      }

      if (sourceRowsRevision != null) {
        await replaceProcessChangeResidualEvidenceSnapshot(tx, {
          sourceRowsRevision,
          evidenceInputs: [],
        });
      }

      await replaceMissingStandardHoursProcesses(tx, []);

      const { pruned, prunedEvidence } = await replaceFkojunstMailProjections(tx, []);
      if (prunedEvidence > 0) await replaceAllWinnerExternalCompletionStatesFromMailSync(tx, true, 'clear-resource-swap');
      return {
        scanned,
        normalized: 0,
        matched: 0,
        unmatched: 0,
        skippedInvalidStatus,
        skippedUnparseableDate,
        upserted: 0,
        pruned,
      };
    },
    {
      maxWait: REPLACEMENT_TX_MAX_WAIT_MS,
      timeout: REPLACEMENT_TX_TIMEOUT_MS,
    }
  );
}
