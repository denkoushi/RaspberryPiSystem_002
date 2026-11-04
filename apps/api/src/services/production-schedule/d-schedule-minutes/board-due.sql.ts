import { Prisma } from '@prisma/client';

import { PRODUCTION_SCHEDULE_DASHBOARD_ID } from '../constants.js';
import type { BoardDueSource } from './resolve-board-due-date.js';

/** Match the authority that produced the row-note due; note edits are not due edits. */
const manualUpdatedAt = Prisma.sql`COALESCE((
  SELECT "manual_processing_due"."updatedAt" FROM "ProductionScheduleSeibanProcessingDueDate" AS "manual_processing_due"
  WHERE "manual_processing_due"."csvDashboardId" = ${PRODUCTION_SCHEDULE_DASHBOARD_ID}
    AND "manual_processing_due"."fseiban" = "CsvDashboardRow"."rowData"->>'FSEIBAN'
    AND "manual_processing_due"."dueDate" = "n"."dueDate"
    AND "manual_processing_due"."processingType" = COALESCE((
      SELECT "due_pp"."processingType" FROM "ProductionSchedulePartProcessingType" AS "due_pp"
      WHERE "due_pp"."csvDashboardId" = ${PRODUCTION_SCHEDULE_DASHBOARD_ID}
        AND "due_pp"."fhincd" = "CsvDashboardRow"."rowData"->>'FHINCD'
    ), "n"."processingType")
), CASE WHEN "manual_seiban_due"."dueDate" = "n"."dueDate" THEN "manual_seiban_due"."updatedAt" ELSE NULL END)`;

/** Shared column; every caller must include BOARD_DUE_JOINS_SQL. */
export const BOARD_MANUAL_UPDATED_AT_SQL = Prisma.sql`"manual_due_at"."manualUpdatedAt"`;

export const BOARD_DUE_JOINS_SQL = Prisma.sql`
  LEFT JOIN "ProductionScheduleDScheduleMinutes" AS "excel_due"
    ON "excel_due"."csvDashboardId" = ${PRODUCTION_SCHEDULE_DASHBOARD_ID}
    AND "excel_due"."fseiban" = "CsvDashboardRow"."rowData"->>'FSEIBAN'
  LEFT JOIN "ProductionScheduleSeibanDueDate" AS "manual_seiban_due"
    ON "manual_seiban_due"."csvDashboardId" = ${PRODUCTION_SCHEDULE_DASHBOARD_ID}
    AND "manual_seiban_due"."fseiban" = "CsvDashboardRow"."rowData"->>'FSEIBAN'
  -- Only Excel-backed rows need the authority time; OFFSET prevents pull-up from duplicating the authority subqueries in SELECT / ORDER BY.
  LEFT JOIN LATERAL (
    SELECT ${manualUpdatedAt} AS "manualUpdatedAt"
    WHERE "excel_due"."partsCompleteDate" IS NOT NULL
    OFFSET 0
  ) AS "manual_due_at" ON TRUE
`;

/** SQL counterpart of resolveBoardDueDate, after the authority/Excel joins. */
export function buildBoardDueDateSql(source: BoardDueSource = 'excel', splitDueDate: Prisma.Sql = Prisma.sql`NULL::date`): Prisma.Sql {
  const parent = source === 'scaw'
    ? Prisma.sql`COALESCE("n"."dueDate", "supplement"."plannedEndDate")`
    : Prisma.sql`CASE
      WHEN "excel_due"."partsCompleteDate" IS NULL THEN COALESCE("n"."dueDate", "supplement"."plannedEndDate")
      WHEN "n"."dueDate" IS NOT NULL AND (${BOARD_MANUAL_UPDATED_AT_SQL}) IS NOT NULL
        AND ("excel_due"."excelChangedAt" IS NULL OR (${BOARD_MANUAL_UPDATED_AT_SQL}) > "excel_due"."excelChangedAt")
        THEN "n"."dueDate"
      ELSE "excel_due"."partsCompleteDate" END`;
  return Prisma.sql`COALESCE(${splitDueDate}, ${parent})`;
}

/** Correlated predicate usable before the list query's due joins are present. */
export function buildBoardDueDateExistsSql(): Prisma.Sql {
  return Prisma.sql`EXISTS (
    SELECT 1 FROM (SELECT 1) AS "due_seed"
    LEFT JOIN "ProductionScheduleRowNote" AS "n"
      ON "n"."csvDashboardRowId" = "CsvDashboardRow"."id"
      AND "n"."csvDashboardId" = ${PRODUCTION_SCHEDULE_DASHBOARD_ID}
    LEFT JOIN "ProductionScheduleOrderSupplement" AS "supplement"
      ON "supplement"."csvDashboardRowId" = "CsvDashboardRow"."id"
      AND "supplement"."csvDashboardId" = ${PRODUCTION_SCHEDULE_DASHBOARD_ID}
      AND (BTRIM(COALESCE("CsvDashboardRow"."rowData"->>'FSEIBAN', '')) <> '********'
        OR "supplement"."productNo" = ("CsvDashboardRow"."rowData"->>'ProductNo'))
    ${BOARD_DUE_JOINS_SQL}
    WHERE ${buildBoardDueDateSql()} IS NOT NULL
  )`;
}
