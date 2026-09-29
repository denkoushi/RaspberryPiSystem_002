import { Prisma } from '@prisma/client';

import { prisma } from '../../../lib/prisma.js';
import { PRODUCTION_SCHEDULE_DASHBOARD_ID } from '../constants.js';
import { fetchFkojunstStatusMailGenerationRevision } from '../fkojunst-status-mail-generation-revision.js';

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
  row: SnapshotMainAndAuxGenerationRow | undefined;
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
  const explicitMailRevision = options?.fkojunstStatusMailRowsRevision?.trim();
  const [mainRows, fkojunstStatusMailRowsRevision] = await Promise.all([
    readMainAndAuxGenerationRow(),
    explicitMailRevision != null && explicitMailRevision.length > 0
      ? Promise.resolve(explicitMailRevision)
      : fetchFkojunstStatusMailGenerationRevision(prisma)
  ]);
  const row = mainRows[0];

  return {
    generationToken: buildLeaderboardShellSnapshotGenerationToken({
      row,
      fkojunstStatusMailRowsRevision
    }),
    fkojunstStatusMailRowsRevision
  };
}

/**
 * 製番 planning board 用の世代 token（shell と同じ永続 raw mail revision を使う）。
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
