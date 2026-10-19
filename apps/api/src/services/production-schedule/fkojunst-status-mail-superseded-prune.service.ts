/**
 * FKOJUNST_Status mail raw 行のうち、同じキー（FKOJUN・FKOTEICD・FSEZONO）の最新行に上書き済みの旧行を削除する。
 *
 * 全利用者（メール同期・residual evidence）は {@link dedupeFkojunstMailRowsByLatest} の勝者だけを使う。
 * dedupe は取り込み順に「現在の勝者」と次の行を比べる畳み込みなので、敗者を消しても現在・将来の勝者は変わらない。
 * キーが欠けて正規化できない行は判定に使われないが、念のため削除しない。
 */
import { Prisma, type PrismaClient } from '@prisma/client';

import { prisma as defaultPrisma } from '../../lib/prisma.js';
import { logger } from '../../lib/logger.js';

import { PRODUCTION_SCHEDULE_FKOJUNST_STATUS_MAIL_DASHBOARD_ID } from './constants.js';
import { acquireFkojunstStatusMailCriticalTransactionLock } from './fkojunst-status-mail-critical-lock.js';
import {
  fetchFkojunstStatusMailGenerationSignals,
  fetchFkojunstStatusMailSourceRowsWithGenerationSignals
} from './fkojunst-status-mail-generation-signals.js';
import {
  collectFkojunstMailNormalizedRowsFromSourceRows,
  dedupeFkojunstMailRowsByLatest
} from './fkojunst-status-mail-sync.pipeline.js';
import { ProductionScheduleFkojunstMailStatusSyncService } from './fkojunst-status-mail-sync.service.js';

import type { FkojunstStatusMailSourceRow } from './fkojunst-status-mail-source-rows.reader.js';

// 1 塊ずつ確定し、塊の間は待って他のクエリを先に通す（Pi5 本番で 5,000 件の塊は 20 秒前後かかった）。
const DEFAULT_DELETE_CHUNK_SIZE = 2_000;
const DEFAULT_PAUSE_BETWEEN_CHUNKS_MS = 1_000;
const CHUNK_TX_TIMEOUT_MS = 120_000;
const CHUNK_TX_MAX_WAIT_MS = 15_000;

export type FkojunstMailSupersededPrunePlan = {
  rowsRevision: string;
  scanned: number;
  normalized: number;
  winners: number;
  deleteIds: string[];
  /** 削除候補の createdAt 月別件数（dry-run 表示用） */
  deleteCountByCreatedMonth: Record<string, number>;
};

export type FkojunstMailSupersededPruneResult =
  | ({ status: 'dry_run'; referencingRows: number } & FkojunstMailSupersededPruneSummary)
  | ({ status: 'nothing_to_delete' } & FkojunstMailSupersededPruneSummary)
  | ({ status: 'over_limit'; maxDelete: number } & FkojunstMailSupersededPruneSummary)
  | ({ status: 'deleted'; deleted: number } & FkojunstMailSupersededPruneSummary)
  | ({ status: 'stopped'; deleted: number; reason: string } & FkojunstMailSupersededPruneSummary);

export type FkojunstMailSupersededPruneSummary = Omit<FkojunstMailSupersededPrunePlan, 'deleteIds'> & {
  deleteCandidates: number;
};

type PruneClient = Pick<PrismaClient, '$queryRaw' | '$transaction'>;

function monthKey(value: Date): string {
  return value.toISOString().slice(0, 7);
}

/** 読み込んだ raw rows から削除候補を決める。勝者だけで dedupe し直して同一になることを確認する。 */
export function planFkojunstMailSupersededPrune(params: {
  sourceRows: readonly FkojunstStatusMailSourceRow[];
  rowsRevision: string;
}): FkojunstMailSupersededPrunePlan {
  const { normalizedRows } = collectFkojunstMailNormalizedRowsFromSourceRows(params.sourceRows);
  const winners = dedupeFkojunstMailRowsByLatest(normalizedRows);
  const winnerIds = new Set(winners.map((row) => row.sourceRowId));

  const kept = normalizedRows.filter((row) => winnerIds.has(row.sourceRowId));
  const rededuped = dedupeFkojunstMailRowsByLatest(kept);
  if (
    rededuped.length !== winners.length ||
    rededuped.some((row) => !winnerIds.has(row.sourceRowId))
  ) {
    throw new Error('[FkojunstMailSupersededPrune] winners changed after removing superseded rows');
  }

  const createdAtById = new Map(params.sourceRows.map((row) => [row.id, row.createdAt]));
  const deleteIds: string[] = [];
  const deleteCountByCreatedMonth: Record<string, number> = {};
  for (const row of normalizedRows) {
    if (winnerIds.has(row.sourceRowId)) continue;
    deleteIds.push(row.sourceRowId);
    const createdAt = createdAtById.get(row.sourceRowId);
    const key = createdAt ? monthKey(createdAt) : 'unknown';
    deleteCountByCreatedMonth[key] = (deleteCountByCreatedMonth[key] ?? 0) + 1;
  }

  return {
    rowsRevision: params.rowsRevision,
    scanned: params.sourceRows.length,
    normalized: normalizedRows.length,
    winners: winners.length,
    deleteIds,
    deleteCountByCreatedMonth
  };
}

type ForeignKeyReference = { tableName: string; columnName: string };

/** `CsvDashboardRow.id` を参照する外部キーを catalog から列挙する（cascade で他データを消さないための確認用）。 */
async function listCsvDashboardRowReferences(
  client: Pick<PrismaClient, '$queryRaw'>
): Promise<ForeignKeyReference[]> {
  return client.$queryRaw<ForeignKeyReference[]>(Prisma.sql`
    SELECT c.conrelid::regclass::text AS "tableName", a.attname AS "columnName"
    FROM pg_constraint c
    JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = ANY (c.conkey)
    WHERE c.contype = 'f'
      AND c.confrelid = '"CsvDashboardRow"'::regclass
  `);
}

/** 削除候補を参照している行の数。1 件でもあれば削除しない。 */
export async function countReferencesToCsvDashboardRows(
  client: Pick<PrismaClient, '$queryRaw'>,
  ids: readonly string[]
): Promise<number> {
  if (ids.length === 0) return 0;
  const references = await listCsvDashboardRowReferences(client);
  let total = 0;
  for (const reference of references) {
    const rows = await client.$queryRaw<Array<{ count: bigint }>>(Prisma.sql`
      SELECT COUNT(*)::bigint AS "count"
      FROM ${Prisma.raw(reference.tableName)}
      WHERE ${Prisma.raw(`"${reference.columnName.replace(/"/g, '""')}"`)} = ANY (${[...ids]}::text[])
    `);
    total += Number(rows[0]?.count ?? 0n);
  }
  return total;
}

type ChunkDeleteOutcome =
  | { kind: 'deleted'; deleted: number; revisionAfter: string }
  | { kind: 'stopped'; reason: string };

/** 1 塊を 1 トランザクションで削除する。revision が期待値でない・参照がある・件数が合わない場合は何も消さない。 */
async function deleteChunk(
  client: PruneClient,
  chunk: readonly string[],
  expectedRevision: string
): Promise<ChunkDeleteOutcome> {
  return client.$transaction(
    async (tx) => {
      await acquireFkojunstStatusMailCriticalTransactionLock(tx);
      const { rowsRevision } = await fetchFkojunstStatusMailGenerationSignals(tx);
      if (rowsRevision !== expectedRevision) {
        return { kind: 'stopped', reason: `raw source revision changed: expected ${expectedRevision}, got ${rowsRevision}` };
      }
      const references = await countReferencesToCsvDashboardRows(tx, chunk);
      if (references > 0) {
        return { kind: 'stopped', reason: `${references} rows reference the delete candidates` };
      }
      const result = await tx.csvDashboardRow.deleteMany({
        where: { id: { in: [...chunk] }, csvDashboardId: PRODUCTION_SCHEDULE_FKOJUNST_STATUS_MAIL_DASHBOARD_ID }
      });
      if (result.count !== chunk.length) {
        throw new Error(
          `[FkojunstMailSupersededPrune] delete count mismatch: expected ${chunk.length}, got ${result.count}`
        );
      }
      // 自分の削除でトリガーが revision を進めるので、次の塊はこの値を期待する。
      const after = await fetchFkojunstStatusMailGenerationSignals(tx);
      return { kind: 'deleted', deleted: result.count, revisionAfter: after.rowsRevision };
    },
    { maxWait: CHUNK_TX_MAX_WAIT_MS, timeout: CHUNK_TX_TIMEOUT_MS }
  );
}

/**
 * 塊ごとに確定する。途中で他の変更（取り込み等）があれば止める。
 * 止まっても消した行はすべて計画時点の敗者なので、勝者（計算結果）は変わらない。
 */
async function deleteSupersededRows(
  client: PruneClient,
  plan: FkojunstMailSupersededPrunePlan,
  options: { chunkSize: number; pauseMs: number; sleep: (ms: number) => Promise<void> }
): Promise<{ deleted: number; stoppedReason?: string }> {
  let expectedRevision = plan.rowsRevision;
  let deleted = 0;
  for (let i = 0; i < plan.deleteIds.length; i += options.chunkSize) {
    if (i > 0 && options.pauseMs > 0) await options.sleep(options.pauseMs);
    const chunk = plan.deleteIds.slice(i, i + options.chunkSize);
    const outcome = await deleteChunk(client, chunk, expectedRevision);
    if (outcome.kind === 'stopped') {
      logger.warn({ deleted, reason: outcome.reason }, '[FkojunstMailSupersededPrune] stopped before finishing');
      return { deleted, stoppedReason: outcome.reason };
    }
    deleted += outcome.deleted;
    expectedRevision = outcome.revisionAfter;
  }
  return { deleted };
}

function summarize(plan: FkojunstMailSupersededPrunePlan): FkojunstMailSupersededPruneSummary {
  const { deleteIds, ...rest } = plan;
  return { ...rest, deleteCandidates: deleteIds.length };
}

/**
 * dry-run は候補の集計と参照確認だけを行う。execute は maxDelete を超える場合は何もしない。
 * 削除すると raw revision が進むため、1 件でも消したらメール同期を 1 回走らせて evidence snapshot を新しい revision に揃える。
 */
export async function runFkojunstMailSupersededPrune(options: {
  mode: 'dry-run' | 'execute';
  maxDelete?: number;
  client?: PruneClient;
  syncService?: Pick<ProductionScheduleFkojunstMailStatusSyncService, 'syncFromStatusMailDashboard'>;
  chunkSize?: number;
  pauseMs?: number;
  sleep?: (ms: number) => Promise<void>;
}): Promise<FkojunstMailSupersededPruneResult> {
  const client = options.client ?? (defaultPrisma as unknown as PruneClient);
  const { sourceRows, signals } = await fetchFkojunstStatusMailSourceRowsWithGenerationSignals(client);
  const plan = planFkojunstMailSupersededPrune({ sourceRows, rowsRevision: signals.rowsRevision });
  const summary = summarize(plan);

  if (options.mode === 'dry-run') {
    const references = await countReferencesToCsvDashboardRows(client, plan.deleteIds);
    return { status: 'dry_run', referencingRows: references, ...summary };
  }
  if (plan.deleteIds.length === 0) {
    return { status: 'nothing_to_delete', ...summary };
  }
  if (options.maxDelete != null && plan.deleteIds.length > options.maxDelete) {
    logger.warn(
      { deleteCandidates: plan.deleteIds.length, maxDelete: options.maxDelete },
      '[FkojunstMailSupersededPrune] over the per-run limit; nothing deleted'
    );
    return { status: 'over_limit', maxDelete: options.maxDelete, ...summary };
  }

  const { deleted, stoppedReason } = await deleteSupersededRows(client, plan, {
    chunkSize: options.chunkSize ?? DEFAULT_DELETE_CHUNK_SIZE,
    pauseMs: options.pauseMs ?? DEFAULT_PAUSE_BETWEEN_CHUNKS_MS,
    sleep: options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)))
  });
  if (deleted > 0) {
    const syncService = options.syncService ?? new ProductionScheduleFkojunstMailStatusSyncService();
    await syncService.syncFromStatusMailDashboard();
  }
  logger.info({ deleted, winners: plan.winners, stoppedReason }, '[FkojunstMailSupersededPrune] superseded mail rows deleted');
  return stoppedReason != null
    ? { status: 'stopped', deleted, reason: stoppedReason, ...summary }
    : { status: 'deleted', deleted, ...summary };
}
