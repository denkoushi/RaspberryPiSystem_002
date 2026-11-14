/**
 * FKOJUNST_Status mail raw 行のうち、同じキー（FKOJUN・FKOTEICD・FSEZONO）の最新行に上書き済みの旧行を削除する。
 *
 * 全利用者（メール同期・residual evidence）は {@link dedupeFkojunstMailRowsByLatest} の勝者だけを使う。
 * キーごとの敗者を全部まとめて消すので勝者は変わらない。比較が推移的でない組み合わせがあるため、一部だけ消さない。
 * キーが欠けて正規化できない行は判定に使われないが、念のため削除しない。
 */
import { Prisma, type PrismaClient } from '@prisma/client';

import { prisma as defaultPrisma } from '../../lib/prisma.js';
import { logger } from '../../lib/logger.js';

import { PRODUCTION_SCHEDULE_FKOJUNST_STATUS_MAIL_DASHBOARD_ID } from './constants.js';
import { acquireFkojunstStatusMailCriticalTransactionLock } from './fkojunst-status-mail-critical-lock.js';
import { fetchFkojunstStatusMailGenerationSignals } from './fkojunst-status-mail-generation-signals.js';
import {
  buildFkojunstMailStatusKey,
  collectFkojunstMailNormalizedRowsFromSourceRows,
  dedupeFkojunstMailRowsByLatest
} from './fkojunst-status-mail-sync.pipeline.js';
import {
  fetchFkojunstStatusMailSourceRowsOrdered,
  type FkojunstStatusMailSourceRow
} from './fkojunst-status-mail-source-rows.reader.js';

// 1 塊ずつ確定し、塊の間は待って他のクエリを先に通す（Pi5 本番で 5,000 件の塊は 20 秒前後かかった）。
const DEFAULT_DELETE_CHUNK_SIZE = 2_000;
const DEFAULT_PAUSE_BETWEEN_CHUNKS_MS = 1_000;
const CHUNK_TX_TIMEOUT_MS = 120_000;
const CHUNK_TX_MAX_WAIT_MS = 15_000;

// 約100万行なら平均約3.2万行/バケット。同じキーへの極端な偏りは別途 dry-run で確認する。
export const FKOJUNST_MAIL_PRUNE_BUCKET_COUNT = 32;

// ECMAScript String.trim() の WhiteSpace + LineTerminator（PostgreSQL btrim の既定は空白のみ）。
export const FKOJUNST_MAIL_PRUNE_TRIM_CHARACTERS = '\u0009\u000a\u000b\u000c\u000d\u0020\u00a0\u1680\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200a\u2028\u2029\u202f\u205f\u3000\ufeff';

/**
 * FSEZONO は trim のみ。FKOTEICD の JS toUpperCase と DB の Unicode/照合順序差を避け、
 * FSEZONO へ射影してハッシュする。同じ正規化キーは必ず同じ値となり、ハッシュ衝突は安全。
 * 論理キーはタブ連結なので、キー内にタブがある場合の別 triple の衝突も同居させるため、
 * 末尾タブ以降だけを使う（reverse 後の先頭部分）。dedupe 自体は既存の JS 正本を使う。
 */
export function buildFkojunstMailPruneBucketWhere(bucket: number): Prisma.Sql {
  if (!Number.isInteger(bucket) || bucket < 0 || bucket >= FKOJUNST_MAIL_PRUNE_BUCKET_COUNT) {
    throw new Error('[FkojunstMailSupersededPrune] invalid bucket');
  }
  return Prisma.sql`
    (('x' || substr(md5(split_part(reverse(btrim(
      COALESCE(r."rowData"->>'FSEZONO', ''), ${FKOJUNST_MAIL_PRUNE_TRIM_CHARACTERS}
    )), chr(9), 1)), 1, 8))::bit(32)::bigint % ${FKOJUNST_MAIL_PRUNE_BUCKET_COUNT}) = ${bucket}
  `;
}

export type FkojunstMailSupersededPrunePlan = {
  rowsRevision: string;
  scanned: number;
  normalized: number;
  winners: number;
  deleteIds: string[];
  /** 同じ論理キーの敗者は、上限・塊・途中停止で分割しない。 */
  deleteIdGroups: string[][];
  /** 削除候補の createdAt 月別件数（dry-run 表示用） */
  deleteCountByCreatedMonth: Record<string, number>;
};

export type FkojunstMailSupersededPruneResult =
  | ({ status: 'dry_run'; referencingRows: number } & FkojunstMailSupersededPruneSummary)
  | ({ status: 'nothing_to_delete' } & FkojunstMailSupersededPruneSummary)
  | ({ status: 'deleted'; deleted: number; reason?: string } & FkojunstMailSupersededPruneSummary)
  | ({ status: 'stopped'; deleted: number; reason: string } & FkojunstMailSupersededPruneSummary);

export type FkojunstMailSupersededPruneSummary = Omit<FkojunstMailSupersededPrunePlan, 'deleteIds' | 'deleteIdGroups'> & {
  /** execute は停止までに計画したバケットだけを集計する。dry-run は全バケット。 */
  deleteCandidates: number;
  hasRemaining: boolean;
  /** 本番 dry-run でキーの偏りと1バケット約5万行以下の目安を確認する。 */
  maxBucketScanned: number;
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
  const deleteIdsByKey = new Map<string, string[]>();
  const deleteCountByCreatedMonth: Record<string, number> = {};
  for (const row of normalizedRows) {
    if (winnerIds.has(row.sourceRowId)) continue;
    deleteIds.push(row.sourceRowId);
    const statusKey = buildFkojunstMailStatusKey(row);
    const group = deleteIdsByKey.get(statusKey) ?? [];
    group.push(row.sourceRowId);
    deleteIdsByKey.set(statusKey, group);
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
    deleteIdGroups: [...deleteIdsByKey.values()],
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

/** バケットの raw rows は計画後に手放し、次のバケットと同時に保持しない。 */
async function planBucket(client: PruneClient, bucket: number, rowsRevision: string) {
  const sourceRows = await fetchFkojunstStatusMailSourceRowsOrdered(client, {
    where: buildFkojunstMailPruneBucketWhere(bucket)
  });
  return planFkojunstMailSupersededPrune({ sourceRows, rowsRevision });
}

/**
 * バケットごとに計画・勝者再確認・削除を終えてから次へ進む。上限まで削除し、残候補を返す。
 * dry-run は全バケットの候補・参照を数える。execute の集計は停止までに読んだ範囲。
 * キーごとの敗者を全部まとめて消すので勝者は変わらず、全件同期は呼ばない。比較が推移的でない
 * 組み合わせがあるため、一部だけ消さない。evidence snapshot の revision
 * 不一致は residual の raw 再計算へフォールバックし、次の取り込み同期で snapshot が揃う。
 */
export async function runFkojunstMailSupersededPrune(options: {
  mode: 'dry-run' | 'execute';
  maxDelete?: number;
  client?: PruneClient;
  chunkSize?: number;
  pauseMs?: number;
  sleep?: (ms: number) => Promise<void>;
}): Promise<FkojunstMailSupersededPruneResult> {
  const client = options.client ?? (defaultPrisma as unknown as PruneClient);
  const maxDelete = options.maxDelete ?? 20_000;
  const chunkSize = options.chunkSize ?? DEFAULT_DELETE_CHUNK_SIZE;
  const pauseMs = options.pauseMs ?? DEFAULT_PAUSE_BETWEEN_CHUNKS_MS;
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  if (!Number.isSafeInteger(maxDelete) || maxDelete < 0 || !Number.isSafeInteger(chunkSize) || chunkSize < 1) {
    throw new Error('[FkojunstMailSupersededPrune] invalid delete limit or chunk size');
  }
  const { rowsRevision } = await fetchFkojunstStatusMailGenerationSignals(client);
  let expectedRevision = rowsRevision;
  const summary: FkojunstMailSupersededPruneSummary = {
    rowsRevision, scanned: 0, normalized: 0, winners: 0,
    deleteCandidates: 0, deleteCountByCreatedMonth: {}, hasRemaining: false, maxBucketScanned: 0
  };
  let deleted = 0;
  let referencingRows = 0;
  for (let bucket = 0; bucket < FKOJUNST_MAIL_PRUNE_BUCKET_COUNT; bucket += 1) {
    // 前バケットの削除後からの取り込み変更も、次の計画を受け入れる前に検出する。
    if (options.mode === 'execute') {
      const current = await fetchFkojunstStatusMailGenerationSignals(client);
      if (current.rowsRevision !== expectedRevision) {
        const reason = `raw source revision changed: expected ${expectedRevision}, got ${current.rowsRevision}`;
        logger.warn({ deleted, reason }, '[FkojunstMailSupersededPrune] stopped before finishing');
        return { status: 'stopped', deleted, ...summary, hasRemaining: true, reason };
      }
    }
    const plan = await planBucket(client, bucket, expectedRevision);
    summary.scanned += plan.scanned;
    summary.maxBucketScanned = Math.max(summary.maxBucketScanned, plan.scanned);
    summary.normalized += plan.normalized;
    summary.winners += plan.winners;
    summary.deleteCandidates += plan.deleteIds.length;
    for (const [month, count] of Object.entries(plan.deleteCountByCreatedMonth)) {
      summary.deleteCountByCreatedMonth[month] = (summary.deleteCountByCreatedMonth[month] ?? 0) + count;
    }
    if (options.mode === 'dry-run') {
      referencingRows += await countReferencesToCsvDashboardRows(client, plan.deleteIds);
      continue;
    }
    const chunks: string[][] = [];
    let chunk: string[] = [];
    let plannedDeletes = deleted;
    let limitReached = false;
    for (const group of plan.deleteIdGroups) {
      // 1 キーだけで上限を超える場合も削除せず、実行上限と勝者を守る。
      if (plannedDeletes + group.length > maxDelete) {
        limitReached = true;
        break;
      }
      if (chunk.length > 0 && chunk.length + group.length > chunkSize) {
        chunks.push(chunk);
        chunk = [];
      }
      chunk.push(...group);
      plannedDeletes += group.length;
    }
    if (chunk.length > 0) chunks.push(chunk);
    for (const chunk of chunks) {
      // バケット境界でも、前の塊を確定済みなら待って他のクエリを通す。
      if (deleted > 0 && pauseMs > 0) await sleep(pauseMs);
      const outcome = await deleteChunk(client, chunk, expectedRevision);
      if (outcome.kind === 'stopped') {
        logger.warn({ deleted, reason: outcome.reason }, '[FkojunstMailSupersededPrune] stopped before finishing');
        return { status: 'stopped', deleted, reason: outcome.reason, ...summary, hasRemaining: true };
      }
      deleted += outcome.deleted;
      expectedRevision = outcome.revisionAfter;
    }
    if (limitReached) {
      const reason = 'max delete limit reached before next key';
      logger.warn({ deleted, reason }, '[FkojunstMailSupersededPrune] stopped before finishing');
      return { status: 'deleted', deleted, ...summary, hasRemaining: true, reason };
    }
    // 上限ちょうどなら、残候補があるバケットまで確認して hasRemaining を正確に返す。
  }
  if (options.mode === 'dry-run') {
    return { status: 'dry_run', referencingRows, ...summary, hasRemaining: summary.deleteCandidates > 0 };
  }
  logger.info({ deleted, winners: summary.winners }, '[FkojunstMailSupersededPrune] superseded mail rows deleted');
  return deleted === 0
    ? { status: 'nothing_to_delete', ...summary }
    : { status: 'deleted', deleted, ...summary };
}
