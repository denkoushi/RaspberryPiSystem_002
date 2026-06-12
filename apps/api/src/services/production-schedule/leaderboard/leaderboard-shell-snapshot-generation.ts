import { Prisma } from '@prisma/client';

import { prisma } from '../../../lib/prisma.js';
import {
  PRODUCTION_SCHEDULE_DASHBOARD_ID,
  PRODUCTION_SCHEDULE_FKOJUNST_STATUS_MAIL_DASHBOARD_ID
} from '../constants.js';

type SnapshotGenerationRow = {
  rowsCount: bigint;
  rowsLatestCreatedAt: Date | null;
  fkojunstStatusMailRowsCount: bigint;
  fkojunstStatusMailRowsLatestCreatedAt: Date | null;
  fkojunstStatusMailRowsLatestUpdatedAt: Date | null;
  orderAssignmentUpdatedAt: Date | null;
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

function buildLeaderboardShellSnapshotGenerationToken(params: {
  row: SnapshotGenerationRow | undefined;
  fkojunstStatusMailRowsRevision: string;
}): string {
  const { row, fkojunstStatusMailRowsRevision } = params;
  return JSON.stringify({
    rowsCount: String(row?.rowsCount ?? 0n),
    rowsLatestCreatedAt: normalizeDate(row?.rowsLatestCreatedAt),
    fkojunstStatusMailRowsRevision,
    orderAssignmentUpdatedAt: normalizeDate(row?.orderAssignmentUpdatedAt),
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
  const rows = await prisma.$queryRaw<SnapshotGenerationRow[]>(Prisma.sql`
    SELECT
      (SELECT COUNT(*)::bigint
       FROM "CsvDashboardRow"
       WHERE "csvDashboardId" = ${PRODUCTION_SCHEDULE_DASHBOARD_ID}) AS "rowsCount",
      (SELECT MAX("createdAt")
       FROM "CsvDashboardRow"
       WHERE "csvDashboardId" = ${PRODUCTION_SCHEDULE_DASHBOARD_ID}) AS "rowsLatestCreatedAt",
      (SELECT COUNT(*)::bigint
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
         )) AS "fkojunstStatusMailRowsCount",
      (SELECT MAX(r."createdAt")
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
         )) AS "fkojunstStatusMailRowsLatestCreatedAt",
      (SELECT MAX(COALESCE(r."updatedAt", r."createdAt"))
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
         )) AS "fkojunstStatusMailRowsLatestUpdatedAt",
      (SELECT MAX("updatedAt")
       FROM "ProductionScheduleOrderAssignment"
       WHERE "csvDashboardId" = ${PRODUCTION_SCHEDULE_DASHBOARD_ID}) AS "orderAssignmentUpdatedAt",
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
  `);

  const row = rows[0];
  const fkojunstStatusMailRowsRevision = resolveFkojunstStatusMailRowsRevision({
    row,
    explicitRevision: options?.fkojunstStatusMailRowsRevision
  });

  return {
    generationToken: buildLeaderboardShellSnapshotGenerationToken({
      row,
      fkojunstStatusMailRowsRevision
    }),
    fkojunstStatusMailRowsRevision
  };
}
