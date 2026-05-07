import { Prisma } from '@prisma/client';

import { prisma } from '../../../lib/prisma.js';
import { PRODUCTION_SCHEDULE_DASHBOARD_ID } from '../constants.js';

type SnapshotGenerationRow = {
  rowsCount: bigint;
  rowsLatestCreatedAt: Date | null;
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

/**
 * shell/continue の整合を壊しうる更新を軽量トークン化する。
 * continue ではこの世代だけを再読込し、全件再計算なしで snapshot 失効を判定する。
 */
export async function readLeaderboardShellSnapshotGenerationToken(): Promise<string> {
  const rows = await prisma.$queryRaw<SnapshotGenerationRow[]>(Prisma.sql`
    SELECT
      (SELECT COUNT(*)::bigint
       FROM "CsvDashboardRow"
       WHERE "csvDashboardId" = ${PRODUCTION_SCHEDULE_DASHBOARD_ID}) AS "rowsCount",
      (SELECT MAX("createdAt")
       FROM "CsvDashboardRow"
       WHERE "csvDashboardId" = ${PRODUCTION_SCHEDULE_DASHBOARD_ID}) AS "rowsLatestCreatedAt",
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
  return JSON.stringify({
    rowsCount: String(row?.rowsCount ?? 0n),
    rowsLatestCreatedAt: normalizeDate(row?.rowsLatestCreatedAt),
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
