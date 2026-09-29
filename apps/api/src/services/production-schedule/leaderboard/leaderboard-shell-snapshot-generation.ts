import { Prisma } from '@prisma/client';

import { prisma } from '../../../lib/prisma.js';
import {
  PRODUCTION_SCHEDULE_DASHBOARD_ID,
  PRODUCTION_SCHEDULE_FKOJUNST_STATUS_MAIL_DASHBOARD_ID
} from '../constants.js';
import { fetchFkojunstStatusMailGenerationRevision } from '../fkojunst-status-mail-generation-revision.js';

const LEADERBOARD_GENERATION_TRANSACTION_OPTIONS = Object.freeze({
  maxWait: 15_000,
  timeout: 60_000
});

/**
 * raw mail の COUNT/MAX は全 mail 行を読むため重い（本番で十数秒）。
 * 取り込み完了時に {@link resetLeaderboardFkojunstStatusMailGenerationCache} で失効させ、
 * 別プロセス（signage worker 等）向けに TTL でも失効させる。
 */
const DEFAULT_FKOJUNST_STATUS_MAIL_GENERATION_CACHE_TTL_MS = 120_000;

type SnapshotMainAndAuxGenerationRow = {
  rowsCount: bigint;
  rowsLatestCreatedAt: Date | null;
  rowsLatestUpdatedAt: Date | null;
  orderAssignmentUpdatedAt: Date | null;
  orderSplitCount: bigint;
  orderSplitUpdatedAt: Date | null;
  orderSplitAssignmentCount: bigint;
  orderSplitAssignmentUpdatedAt: Date | null;
  globalRowRankUpdatedAt: Date | null;
  rowNoteUpdatedAt: Date | null;
  progressUpdatedAt: Date | null;
  externalCompletionUpdatedAt: Date | null;
  fkstUpdatedAt: Date | null;
  fkmailUpdatedAt: Date | null;
  orderSupplementUpdatedAt: Date | null;
  seibanDueDateUpdatedAt: Date | null;
  seibanProcessingDueDateUpdatedAt: Date | null;
  resourceCategoryUpdatedAt: Date | null;
  resourceCodeMappingUpdatedAt: Date | null;
};

type SnapshotMailGenerationRow = {
  fkojunstStatusMailRowsCount: bigint;
  fkojunstStatusMailRowsLatestCreatedAt: Date | null;
  fkojunstStatusMailRowsLatestUpdatedAt: Date | null;
};

type SnapshotGenerationRow = SnapshotMainAndAuxGenerationRow & Partial<SnapshotMailGenerationRow>;

function normalizeDate(value: Date | null | undefined): string {
  return value instanceof Date ? value.toISOString() : '';
}

export type ReadLeaderboardShellSnapshotGenerationTokenOptions = {
  /** materialize が直前に読んだ raw mail revision。指定時は同じ revision を token に使う。 */
  fkojunstStatusMailRowsRevision?: string;
};

export type LeaderboardShellSnapshotGenerationTokenDetails = {
  generationToken: string;
  fkojunstStatusMailRowsRevision: string;
};

function resolveFkojunstStatusMailRowsRevision(params: {
  row: SnapshotGenerationRow | undefined;
  explicitRevision?: string;
}): string {
  const explicitRevision = params.explicitRevision?.trim();
  if (explicitRevision != null && explicitRevision.length > 0) {
    return explicitRevision;
  }

  return [
    String(params.row?.fkojunstStatusMailRowsCount ?? 0n),
    normalizeDate(params.row?.fkojunstStatusMailRowsLatestCreatedAt),
    normalizeDate(params.row?.fkojunstStatusMailRowsLatestUpdatedAt)
  ].join(':');
}

function resolveFkojunstStatusMailGenerationCacheTtlMs(): number {
  const raw = process.env.LEADERBOARD_MAIL_REVISION_CACHE_TTL_MS?.trim();
  if (raw == null || raw.length === 0) return DEFAULT_FKOJUNST_STATUS_MAIL_GENERATION_CACHE_TTL_MS;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : DEFAULT_FKOJUNST_STATUS_MAIL_GENERATION_CACHE_TTL_MS;
}

let mailGenerationCache: { rows: SnapshotMailGenerationRow[]; expiresAt: number } | undefined;
let mailGenerationInFlight: Promise<SnapshotMailGenerationRow[]> | undefined;
let mailGenerationEpoch = 0;

/** FKOJUNST_Status mail の取り込み・同期完了後に呼ぶ。次回の世代トークンで raw mail を読み直す。 */
export function resetLeaderboardFkojunstStatusMailGenerationCache(): void {
  mailGenerationEpoch += 1;
  mailGenerationCache = undefined;
  mailGenerationInFlight = undefined;
}

async function readMailGenerationRows(): Promise<SnapshotMailGenerationRow[]> {
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw(Prisma.sql`SET LOCAL jit = off`);
    return tx.$queryRaw<SnapshotMailGenerationRow[]>(Prisma.sql`
      SELECT
        COUNT(*)::bigint AS "fkojunstStatusMailRowsCount",
        MAX(r."createdAt") AS "fkojunstStatusMailRowsLatestCreatedAt",
        MAX(COALESCE(r."updatedAt", r."createdAt")) AS "fkojunstStatusMailRowsLatestUpdatedAt"
      FROM "CsvDashboardRow" r
      WHERE r."csvDashboardId" = ${PRODUCTION_SCHEDULE_FKOJUNST_STATUS_MAIL_DASHBOARD_ID}
        AND (
          r."sourceIngestRunId" IS NULL
          OR EXISTS (
            SELECT 1
            FROM "CsvDashboardIngestRun" ir
            WHERE ir."id" = r."sourceIngestRunId"
              AND ir."status" = 'COMPLETED'::"ImportStatus"
              AND ir."completedAt" IS NOT NULL
          )
        )
    `);
  }, LEADERBOARD_GENERATION_TRANSACTION_OPTIONS);
}

/** TTL 内は前回結果を再利用し、同時呼び出しは 1 本の SQL にまとめる。 */
async function readMailGenerationRowsCached(): Promise<SnapshotMailGenerationRow[]> {
  const ttlMs = resolveFkojunstStatusMailGenerationCacheTtlMs();
  if (ttlMs === 0) return readMailGenerationRows();
  if (mailGenerationCache && mailGenerationCache.expiresAt > Date.now()) {
    return mailGenerationCache.rows;
  }
  if (mailGenerationInFlight) return mailGenerationInFlight;

  const epoch = mailGenerationEpoch;
  const inFlight = readMailGenerationRows().then((rows) => {
    if (epoch === mailGenerationEpoch) {
      mailGenerationCache = { rows, expiresAt: Date.now() + ttlMs };
    }
    return rows;
  });
  mailGenerationInFlight = inFlight;
  try {
    return await inFlight;
  } finally {
    if (mailGenerationInFlight === inFlight) {
      mailGenerationInFlight = undefined;
    }
  }
}

async function readMainAndAuxGenerationRow(): Promise<SnapshotMainAndAuxGenerationRow[]> {
  return prisma.$queryRaw<SnapshotMainAndAuxGenerationRow[]>(Prisma.sql`
    SELECT
      "mainRowStats"."rowsCount",
      "mainRowStats"."rowsLatestCreatedAt",
      "mainRowStats"."rowsLatestUpdatedAt",
      (SELECT MAX("updatedAt")
       FROM "ProductionScheduleOrderAssignment"
       WHERE "csvDashboardId" = ${PRODUCTION_SCHEDULE_DASHBOARD_ID}) AS "orderAssignmentUpdatedAt",
      (SELECT COUNT(*)::bigint
       FROM "ProductionScheduleOrderSplit"
       WHERE "csvDashboardId" = ${PRODUCTION_SCHEDULE_DASHBOARD_ID}) AS "orderSplitCount",
      (SELECT MAX("updatedAt")
       FROM "ProductionScheduleOrderSplit"
       WHERE "csvDashboardId" = ${PRODUCTION_SCHEDULE_DASHBOARD_ID}) AS "orderSplitUpdatedAt",
      (SELECT COUNT(*)::bigint
       FROM "ProductionScheduleOrderSplitAssignment"
       WHERE "csvDashboardId" = ${PRODUCTION_SCHEDULE_DASHBOARD_ID}) AS "orderSplitAssignmentCount",
      (SELECT MAX("updatedAt")
       FROM "ProductionScheduleOrderSplitAssignment"
       WHERE "csvDashboardId" = ${PRODUCTION_SCHEDULE_DASHBOARD_ID}) AS "orderSplitAssignmentUpdatedAt",
      (SELECT MAX("updatedAt")
       FROM "ProductionScheduleGlobalRowRank"
       WHERE "csvDashboardId" = ${PRODUCTION_SCHEDULE_DASHBOARD_ID}) AS "globalRowRankUpdatedAt",
      (SELECT MAX("updatedAt")
       FROM "ProductionScheduleRowNote"
       WHERE "csvDashboardId" = ${PRODUCTION_SCHEDULE_DASHBOARD_ID}) AS "rowNoteUpdatedAt",
      (SELECT MAX("updatedAt")
       FROM "ProductionScheduleProgress"
       WHERE "csvDashboardId" = ${PRODUCTION_SCHEDULE_DASHBOARD_ID}) AS "progressUpdatedAt",
      (SELECT MAX("updatedAt")
       FROM "ProductionScheduleExternalCompletion"
       WHERE "csvDashboardId" = ${PRODUCTION_SCHEDULE_DASHBOARD_ID}) AS "externalCompletionUpdatedAt",
      (SELECT MAX("updatedAt")
       FROM "ProductionScheduleFkojunstStatus"
       WHERE "csvDashboardId" = ${PRODUCTION_SCHEDULE_DASHBOARD_ID}) AS "fkstUpdatedAt",
      (SELECT MAX("updatedAt")
       FROM "ProductionScheduleFkojunstMailStatus"
       WHERE "csvDashboardId" = ${PRODUCTION_SCHEDULE_DASHBOARD_ID}) AS "fkmailUpdatedAt",
      (SELECT MAX("updatedAt")
       FROM "ProductionScheduleOrderSupplement"
       WHERE "csvDashboardId" = ${PRODUCTION_SCHEDULE_DASHBOARD_ID}) AS "orderSupplementUpdatedAt",
      (SELECT MAX("updatedAt")
       FROM "ProductionScheduleSeibanDueDate"
       WHERE "csvDashboardId" = ${PRODUCTION_SCHEDULE_DASHBOARD_ID}) AS "seibanDueDateUpdatedAt",
      (SELECT MAX("updatedAt")
       FROM "ProductionScheduleSeibanProcessingDueDate"
       WHERE "csvDashboardId" = ${PRODUCTION_SCHEDULE_DASHBOARD_ID}) AS "seibanProcessingDueDateUpdatedAt",
      (SELECT MAX("updatedAt")
       FROM "ProductionScheduleResourceCategoryConfig"
       WHERE "csvDashboardId" = ${PRODUCTION_SCHEDULE_DASHBOARD_ID}) AS "resourceCategoryUpdatedAt",
      (SELECT MAX("updatedAt")
       FROM "ProductionScheduleResourceCodeMapping"
       WHERE "csvDashboardId" = ${PRODUCTION_SCHEDULE_DASHBOARD_ID}) AS "resourceCodeMappingUpdatedAt"
    FROM (
      SELECT
        COUNT(*)::bigint AS "rowsCount",
        MAX("createdAt") AS "rowsLatestCreatedAt",
        MAX(COALESCE("updatedAt", "createdAt")) AS "rowsLatestUpdatedAt"
      FROM "CsvDashboardRow"
      WHERE "csvDashboardId" = ${PRODUCTION_SCHEDULE_DASHBOARD_ID}
    ) AS "mainRowStats"
  `);
}

function buildLeaderboardShellSnapshotGenerationToken(params: {
  row: SnapshotGenerationRow | undefined;
  fkojunstStatusMailRowsRevision: string;
}): string {
  const { row, fkojunstStatusMailRowsRevision } = params;
  return JSON.stringify({
    rowsCount: String(row?.rowsCount ?? 0n),
    rowsLatestCreatedAt: normalizeDate(row?.rowsLatestCreatedAt),
    rowsLatestUpdatedAt: normalizeDate(row?.rowsLatestUpdatedAt),
    fkojunstStatusMailRowsRevision,
    orderAssignmentUpdatedAt: normalizeDate(row?.orderAssignmentUpdatedAt),
    orderSplitCount: String(row?.orderSplitCount ?? 0n),
    orderSplitUpdatedAt: normalizeDate(row?.orderSplitUpdatedAt),
    orderSplitAssignmentCount: String(row?.orderSplitAssignmentCount ?? 0n),
    orderSplitAssignmentUpdatedAt: normalizeDate(row?.orderSplitAssignmentUpdatedAt),
    globalRowRankUpdatedAt: normalizeDate(row?.globalRowRankUpdatedAt),
    rowNoteUpdatedAt: normalizeDate(row?.rowNoteUpdatedAt),
    progressUpdatedAt: normalizeDate(row?.progressUpdatedAt),
    externalCompletionUpdatedAt: normalizeDate(row?.externalCompletionUpdatedAt),
    fkstUpdatedAt: normalizeDate(row?.fkstUpdatedAt),
    fkmailUpdatedAt: normalizeDate(row?.fkmailUpdatedAt),
    orderSupplementUpdatedAt: normalizeDate(row?.orderSupplementUpdatedAt),
    seibanDueDateUpdatedAt: normalizeDate(row?.seibanDueDateUpdatedAt),
    seibanProcessingDueDateUpdatedAt: normalizeDate(row?.seibanProcessingDueDateUpdatedAt),
    resourceCategoryUpdatedAt: normalizeDate(row?.resourceCategoryUpdatedAt),
    resourceCodeMappingUpdatedAt: normalizeDate(row?.resourceCodeMappingUpdatedAt)
  });
}

/**
 * shell/continue 用世代トークン。集約 board 等では同一 HTTP リクエスト内 1 回読んで渡す。
 */
export async function resolveLeaderboardShellSnapshotGenerationToken(
  cachedGenerationToken?: string
): Promise<string> {
  if (cachedGenerationToken != null && cachedGenerationToken.length > 0) {
    return cachedGenerationToken;
  }
  return readLeaderboardShellSnapshotGenerationToken();
}

/**
 * shell/continue の整合を壊しうる更新を軽量トークン化する。
 * continue ではこの世代だけを再読込し、全件再計算なしで snapshot 失効を判定する。
 */
export async function readLeaderboardShellSnapshotGenerationToken(
  options?: ReadLeaderboardShellSnapshotGenerationTokenOptions
): Promise<string> {
  const details = await readLeaderboardShellSnapshotGenerationTokenDetails(options);
  return details.generationToken;
}

export async function readLeaderboardShellSnapshotGenerationTokenDetails(
  options?: ReadLeaderboardShellSnapshotGenerationTokenOptions
): Promise<LeaderboardShellSnapshotGenerationTokenDetails> {
  const mainRows = await readMainAndAuxGenerationRow();
  const explicitMailRevision = options?.fkojunstStatusMailRowsRevision?.trim();
  const mailRows =
    explicitMailRevision != null && explicitMailRevision.length > 0
      ? []
      : await readMailGenerationRowsCached();

  const row = {
    ...mainRows[0],
    ...mailRows[0]
  };
  const fkojunstStatusMailRowsRevision = resolveFkojunstStatusMailRowsRevision({
    row,
    explicitRevision: explicitMailRevision
  });

  return {
    generationToken: buildLeaderboardShellSnapshotGenerationToken({
      row,
      fkojunstStatusMailRowsRevision
    }),
    fkojunstStatusMailRowsRevision
  };
}

/**
 * 製番 planning board 専用の世代 token。
 * shared shell/continue の rawMailRowsRevision 契約は維持し、board のみ永続 revision を使う。
 */
export async function readGrindingPlanningBoardSnapshotGenerationTokenDetails(): Promise<LeaderboardShellSnapshotGenerationTokenDetails> {
  const [mainRows, fkojunstStatusMailGenerationRevision] = await Promise.all([
    readMainAndAuxGenerationRow(),
    fetchFkojunstStatusMailGenerationRevision(prisma)
  ]);
  const row = mainRows[0];
  return {
    generationToken: buildLeaderboardShellSnapshotGenerationToken({
      row,
      fkojunstStatusMailRowsRevision: fkojunstStatusMailGenerationRevision
    }),
    fkojunstStatusMailRowsRevision: fkojunstStatusMailGenerationRevision
  };
}

export async function readGrindingPlanningBoardSnapshotGenerationToken(): Promise<string> {
  return (await readGrindingPlanningBoardSnapshotGenerationTokenDetails()).generationToken;
}
