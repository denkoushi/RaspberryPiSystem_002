import { Prisma } from '@prisma/client';

import { prisma } from '../../../lib/prisma.js';
import {
  COMPLETED_PROGRESS_VALUE,
  PRODUCTION_SCHEDULE_DASHBOARD_ID,
} from '../constants.js';
import { GLOBAL_SHARED_LOCATION_KEY } from '../due-management-ranking-scope-policy.service.js';
import {
  buildFkojunstProductionScheduleListRowDataFkojunstSql,
  buildFkojunstProductionScheduleListVisibilityWhereSql,
} from '../policies/fkojunst-production-schedule-list-visibility.policy.js';
import { buildProductionScheduleEffectiveCompletedSql } from '../production-schedule-effective-completion.sql.js';

/**
 * `listProductionScheduleRows` と同一形状（enrich 前）の行。
 * responseProfile=leaderboard 専用の優先取得で使用する。
 */
export type LeaderboardScheduleRowSql = {
  id: string;
  seibanJoinKey: string | null;
  occurredAt: Date;
  rowData: Prisma.JsonValue;
  processingOrder: number | null;
  globalRank: number | null;
  note: string | null;
  processingType: string | null;
  dueDate: Date | null;
  plannedQuantity: number | null;
  plannedStartDate: Date | null;
  plannedEndDate: Date | null;
};

const dueSortExpr = Prisma.sql`COALESCE("n"."dueDate", "supplement"."plannedEndDate")`;

function readFseibanFromRow(row: LeaderboardScheduleRowSql): string {
  const data = (row.rowData ?? {}) as Record<string, unknown>;
  const raw = data.FSEIBAN;
  return typeof raw === 'string' ? raw.trim() : '';
}

/**
 * 順位ボード: 手動割当つき行を必ず含め、同一製番はまとめて取得し、
 * 残り枠を納期（表示納期に近い COALESCE）昇順で補完する。
 *
 * - `pageSize` を超えるよう手動+製番展開が膨らんだ場合でも、手動側を切り捨てない。
 * - `pageSize` 未満のときだけフィラーを追加し、合計を `pageSize` まで埋める。
 */
export async function fetchLeaderboardScheduleRowsWithSeibanAwarePriority(params: {
  baseWhere: Prisma.Sql;
  queryWhere: Prisma.Sql;
  expansionWhere: Prisma.Sql;
  locationKey: string;
  siteScopedGlobalRankLocation: string;
  pageSize: number;
}): Promise<LeaderboardScheduleRowSql[]> {
  const { baseWhere, queryWhere, expansionWhere, locationKey, siteScopedGlobalRankLocation } = params;
  const pageSize = Math.max(1, params.pageSize);

  const visibilitySql = buildFkojunstProductionScheduleListVisibilityWhereSql();
  const commonWhere = Prisma.sql`${baseWhere} ${queryWhere} ${visibilitySql}`;

  const processingOrderScalar = Prisma.sql`(
    SELECT "orderNumber"
    FROM "ProductionScheduleOrderAssignment"
    WHERE "csvDashboardRowId" = "CsvDashboardRow"."id"
      AND (
        "location" = ${locationKey}
        OR "siteKey" = ${locationKey}
      )
    ORDER BY
      CASE WHEN "location" = ${locationKey} THEN 0 ELSE 1 END ASC,
      "updatedAt" DESC
    LIMIT 1
  )`;

  const manualRows = await prisma.$queryRaw<LeaderboardScheduleRowSql[]>`
    SELECT
      "CsvDashboardRow"."id",
      NULLIF(BTRIM("CsvDashboardRow"."rowData"->>'FSEIBAN'), '') AS "seibanJoinKey",
      "CsvDashboardRow"."occurredAt",
      jsonb_build_object(
        'ProductNo', "CsvDashboardRow"."rowData"->>'ProductNo',
        'FSEIBAN', "CsvDashboardRow"."rowData"->>'FSEIBAN',
        'FHINCD', "CsvDashboardRow"."rowData"->>'FHINCD',
        'FHINMEI', "CsvDashboardRow"."rowData"->>'FHINMEI',
        'FSIGENCD', "CsvDashboardRow"."rowData"->>'FSIGENCD',
        'FSIGENSHOYORYO', "CsvDashboardRow"."rowData"->>'FSIGENSHOYORYO',
        'FKOJUN', "CsvDashboardRow"."rowData"->>'FKOJUN',
        'FKOJUNST', ( ${buildFkojunstProductionScheduleListRowDataFkojunstSql()} ),
        'progress', (CASE WHEN ${buildProductionScheduleEffectiveCompletedSql()} THEN ${COMPLETED_PROGRESS_VALUE} ELSE '' END)
      ) AS "rowData",
      ${processingOrderScalar} AS "processingOrder",
      (
        SELECT "globalRank"
        FROM "ProductionScheduleGlobalRowRank"
        WHERE "csvDashboardRowId" = "CsvDashboardRow"."id"
          AND "csvDashboardId" = ${PRODUCTION_SCHEDULE_DASHBOARD_ID}
          AND "location" IN (${siteScopedGlobalRankLocation}, ${GLOBAL_SHARED_LOCATION_KEY}, ${locationKey})
        ORDER BY CASE
          WHEN "location" = ${siteScopedGlobalRankLocation} THEN 0
          WHEN "location" = ${GLOBAL_SHARED_LOCATION_KEY} THEN 1
          ELSE 2
        END ASC
        LIMIT 1
      ) AS "globalRank",
      NULLIF(TRIM("n"."note"), '') AS "note",
      COALESCE("pp"."processingType", "n"."processingType") AS "processingType",
      "n"."dueDate" AS "dueDate",
      "supplement"."plannedQuantity" AS "plannedQuantity",
      "supplement"."plannedStartDate" AS "plannedStartDate",
      "supplement"."plannedEndDate" AS "plannedEndDate"
    FROM "CsvDashboardRow"
    LEFT JOIN "ProductionScheduleProgress" AS "p"
      ON "p"."csvDashboardRowId" = "CsvDashboardRow"."id"
      AND "p"."csvDashboardId" = ${PRODUCTION_SCHEDULE_DASHBOARD_ID}
    LEFT JOIN "ProductionScheduleExternalCompletion" AS "ext"
      ON "ext"."csvDashboardRowId" = "CsvDashboardRow"."id"
      AND "ext"."csvDashboardId" = ${PRODUCTION_SCHEDULE_DASHBOARD_ID}
    LEFT JOIN "ProductionScheduleRowNote" AS "n"
      ON "n"."csvDashboardRowId" = "CsvDashboardRow"."id"
      AND "n"."csvDashboardId" = ${PRODUCTION_SCHEDULE_DASHBOARD_ID}
    LEFT JOIN "ProductionSchedulePartProcessingType" AS "pp"
      ON "pp"."csvDashboardId" = ${PRODUCTION_SCHEDULE_DASHBOARD_ID}
      AND "pp"."fhincd" = ("CsvDashboardRow"."rowData"->>'FHINCD')
    LEFT JOIN "ProductionScheduleOrderSupplement" AS "supplement"
      ON "supplement"."csvDashboardRowId" = "CsvDashboardRow"."id"
      AND "supplement"."csvDashboardId" = ${PRODUCTION_SCHEDULE_DASHBOARD_ID}
    LEFT JOIN "ProductionScheduleFkojunstStatus" AS "fkst"
      ON "fkst"."csvDashboardRowId" = "CsvDashboardRow"."id"
      AND "fkst"."csvDashboardId" = ${PRODUCTION_SCHEDULE_DASHBOARD_ID}
    LEFT JOIN "ProductionScheduleFkojunstMailStatus" AS "fkmail"
      ON "fkmail"."csvDashboardRowId" = "CsvDashboardRow"."id"
      AND "fkmail"."csvDashboardId" = ${PRODUCTION_SCHEDULE_DASHBOARD_ID}
    WHERE ${commonWhere}
      AND EXISTS (
        SELECT 1
        FROM "ProductionScheduleOrderAssignment" AS "ord_m"
        WHERE "ord_m"."csvDashboardRowId" = "CsvDashboardRow"."id"
          AND "ord_m"."csvDashboardId" = ${PRODUCTION_SCHEDULE_DASHBOARD_ID}
          AND (
            "ord_m"."location" = ${locationKey}
            OR "ord_m"."siteKey" = ${locationKey}
          )
      )
    ORDER BY
      ${processingOrderScalar} ASC NULLS LAST,
      ${dueSortExpr} ASC NULLS LAST,
      ("CsvDashboardRow"."rowData"->>'FSEIBAN') ASC,
      ("CsvDashboardRow"."rowData"->>'ProductNo') ASC,
      (CASE
        WHEN ("CsvDashboardRow"."rowData"->>'FKOJUN') ~ '^\\d+$' THEN (("CsvDashboardRow"."rowData"->>'FKOJUN'))::int
        ELSE NULL
      END) ASC NULLS LAST,
      ("CsvDashboardRow"."rowData"->>'FHINCD') ASC
  `;

  const seibanSet = new Set<string>();
  for (const row of manualRows) {
    const fs = readFseibanFromRow(row);
    if (fs.length > 0) seibanSet.add(fs);
  }

  const idToRow = new Map<string, LeaderboardScheduleRowSql>();
  for (const r of manualRows) {
    idToRow.set(r.id, r);
  }

  if (seibanSet.size > 0) {
    const seibanList = Array.from(seibanSet);
    const seibanCondition = Prisma.sql`NULLIF(BTRIM("CsvDashboardRow"."rowData"->>'FSEIBAN'), '') IN (${Prisma.join(
      seibanList.map((s) => Prisma.sql`${s}`)
    )})`;

    const expansionRows = await prisma.$queryRaw<LeaderboardScheduleRowSql[]>`
      SELECT
        "CsvDashboardRow"."id",
        NULLIF(BTRIM("CsvDashboardRow"."rowData"->>'FSEIBAN'), '') AS "seibanJoinKey",
        "CsvDashboardRow"."occurredAt",
        jsonb_build_object(
          'ProductNo', "CsvDashboardRow"."rowData"->>'ProductNo',
          'FSEIBAN', "CsvDashboardRow"."rowData"->>'FSEIBAN',
          'FHINCD', "CsvDashboardRow"."rowData"->>'FHINCD',
          'FHINMEI', "CsvDashboardRow"."rowData"->>'FHINMEI',
          'FSIGENCD', "CsvDashboardRow"."rowData"->>'FSIGENCD',
          'FSIGENSHOYORYO', "CsvDashboardRow"."rowData"->>'FSIGENSHOYORYO',
          'FKOJUN', "CsvDashboardRow"."rowData"->>'FKOJUN',
          'FKOJUNST', ( ${buildFkojunstProductionScheduleListRowDataFkojunstSql()} ),
          'progress', (CASE WHEN ${buildProductionScheduleEffectiveCompletedSql()} THEN ${COMPLETED_PROGRESS_VALUE} ELSE '' END)
        ) AS "rowData",
        ${processingOrderScalar} AS "processingOrder",
        (
          SELECT "globalRank"
          FROM "ProductionScheduleGlobalRowRank"
          WHERE "csvDashboardRowId" = "CsvDashboardRow"."id"
            AND "csvDashboardId" = ${PRODUCTION_SCHEDULE_DASHBOARD_ID}
            AND "location" IN (${siteScopedGlobalRankLocation}, ${GLOBAL_SHARED_LOCATION_KEY}, ${locationKey})
          ORDER BY CASE
            WHEN "location" = ${siteScopedGlobalRankLocation} THEN 0
            WHEN "location" = ${GLOBAL_SHARED_LOCATION_KEY} THEN 1
            ELSE 2
          END ASC
          LIMIT 1
        ) AS "globalRank",
        NULLIF(TRIM("n"."note"), '') AS "note",
        COALESCE("pp"."processingType", "n"."processingType") AS "processingType",
        "n"."dueDate" AS "dueDate",
        "supplement"."plannedQuantity" AS "plannedQuantity",
        "supplement"."plannedStartDate" AS "plannedStartDate",
        "supplement"."plannedEndDate" AS "plannedEndDate"
      FROM "CsvDashboardRow"
      LEFT JOIN "ProductionScheduleProgress" AS "p"
        ON "p"."csvDashboardRowId" = "CsvDashboardRow"."id"
        AND "p"."csvDashboardId" = ${PRODUCTION_SCHEDULE_DASHBOARD_ID}
      LEFT JOIN "ProductionScheduleExternalCompletion" AS "ext"
        ON "ext"."csvDashboardRowId" = "CsvDashboardRow"."id"
        AND "ext"."csvDashboardId" = ${PRODUCTION_SCHEDULE_DASHBOARD_ID}
      LEFT JOIN "ProductionScheduleRowNote" AS "n"
        ON "n"."csvDashboardRowId" = "CsvDashboardRow"."id"
        AND "n"."csvDashboardId" = ${PRODUCTION_SCHEDULE_DASHBOARD_ID}
      LEFT JOIN "ProductionSchedulePartProcessingType" AS "pp"
        ON "pp"."csvDashboardId" = ${PRODUCTION_SCHEDULE_DASHBOARD_ID}
        AND "pp"."fhincd" = ("CsvDashboardRow"."rowData"->>'FHINCD')
      LEFT JOIN "ProductionScheduleOrderSupplement" AS "supplement"
        ON "supplement"."csvDashboardRowId" = "CsvDashboardRow"."id"
        AND "supplement"."csvDashboardId" = ${PRODUCTION_SCHEDULE_DASHBOARD_ID}
      LEFT JOIN "ProductionScheduleFkojunstStatus" AS "fkst"
        ON "fkst"."csvDashboardRowId" = "CsvDashboardRow"."id"
        AND "fkst"."csvDashboardId" = ${PRODUCTION_SCHEDULE_DASHBOARD_ID}
      LEFT JOIN "ProductionScheduleFkojunstMailStatus" AS "fkmail"
        ON "fkmail"."csvDashboardRowId" = "CsvDashboardRow"."id"
        AND "fkmail"."csvDashboardId" = ${PRODUCTION_SCHEDULE_DASHBOARD_ID}
      WHERE ${baseWhere} ${expansionWhere} ${visibilitySql}
        AND ${seibanCondition}
      ORDER BY
        ${dueSortExpr} ASC NULLS LAST,
        ("CsvDashboardRow"."rowData"->>'FSEIBAN') ASC,
        ("CsvDashboardRow"."rowData"->>'ProductNo') ASC,
        (CASE
          WHEN ("CsvDashboardRow"."rowData"->>'FKOJUN') ~ '^\\d+$' THEN (("CsvDashboardRow"."rowData"->>'FKOJUN'))::int
          ELSE NULL
        END) ASC NULLS LAST,
        ("CsvDashboardRow"."rowData"->>'FHINCD') ASC
    `;
    for (const r of expansionRows) {
      if (!idToRow.has(r.id)) {
        idToRow.set(r.id, r);
      }
    }
  }

  const selected = Array.from(idToRow.values());
  if (selected.length >= pageSize) {
    return sortLeaderboardFetchRows(selected);
  }

  const excludeIds = Array.from(idToRow.keys());
  const fillLimit = pageSize - selected.length;
  const excludeSql =
    excludeIds.length > 0
      ? Prisma.sql`AND NOT ("CsvDashboardRow"."id" IN (${Prisma.join(
          excludeIds.map((id) => Prisma.sql`${id}`)
        )}))`
      : Prisma.empty;

  const fillerRows = await prisma.$queryRaw<LeaderboardScheduleRowSql[]>`
    SELECT
      "CsvDashboardRow"."id",
      NULLIF(BTRIM("CsvDashboardRow"."rowData"->>'FSEIBAN'), '') AS "seibanJoinKey",
      "CsvDashboardRow"."occurredAt",
      jsonb_build_object(
        'ProductNo', "CsvDashboardRow"."rowData"->>'ProductNo',
        'FSEIBAN', "CsvDashboardRow"."rowData"->>'FSEIBAN',
        'FHINCD', "CsvDashboardRow"."rowData"->>'FHINCD',
        'FHINMEI', "CsvDashboardRow"."rowData"->>'FHINMEI',
        'FSIGENCD', "CsvDashboardRow"."rowData"->>'FSIGENCD',
        'FSIGENSHOYORYO', "CsvDashboardRow"."rowData"->>'FSIGENSHOYORYO',
        'FKOJUN', "CsvDashboardRow"."rowData"->>'FKOJUN',
        'FKOJUNST', ( ${buildFkojunstProductionScheduleListRowDataFkojunstSql()} ),
        'progress', (CASE WHEN ${buildProductionScheduleEffectiveCompletedSql()} THEN ${COMPLETED_PROGRESS_VALUE} ELSE '' END)
      ) AS "rowData",
      ${processingOrderScalar} AS "processingOrder",
      (
        SELECT "globalRank"
        FROM "ProductionScheduleGlobalRowRank"
        WHERE "csvDashboardRowId" = "CsvDashboardRow"."id"
          AND "csvDashboardId" = ${PRODUCTION_SCHEDULE_DASHBOARD_ID}
          AND "location" IN (${siteScopedGlobalRankLocation}, ${GLOBAL_SHARED_LOCATION_KEY}, ${locationKey})
        ORDER BY CASE
          WHEN "location" = ${siteScopedGlobalRankLocation} THEN 0
          WHEN "location" = ${GLOBAL_SHARED_LOCATION_KEY} THEN 1
          ELSE 2
        END ASC
        LIMIT 1
      ) AS "globalRank",
      NULLIF(TRIM("n"."note"), '') AS "note",
      COALESCE("pp"."processingType", "n"."processingType") AS "processingType",
      "n"."dueDate" AS "dueDate",
      "supplement"."plannedQuantity" AS "plannedQuantity",
      "supplement"."plannedStartDate" AS "plannedStartDate",
      "supplement"."plannedEndDate" AS "plannedEndDate"
    FROM "CsvDashboardRow"
    LEFT JOIN "ProductionScheduleProgress" AS "p"
      ON "p"."csvDashboardRowId" = "CsvDashboardRow"."id"
      AND "p"."csvDashboardId" = ${PRODUCTION_SCHEDULE_DASHBOARD_ID}
    LEFT JOIN "ProductionScheduleExternalCompletion" AS "ext"
      ON "ext"."csvDashboardRowId" = "CsvDashboardRow"."id"
      AND "ext"."csvDashboardId" = ${PRODUCTION_SCHEDULE_DASHBOARD_ID}
    LEFT JOIN "ProductionScheduleRowNote" AS "n"
      ON "n"."csvDashboardRowId" = "CsvDashboardRow"."id"
      AND "n"."csvDashboardId" = ${PRODUCTION_SCHEDULE_DASHBOARD_ID}
    LEFT JOIN "ProductionSchedulePartProcessingType" AS "pp"
      ON "pp"."csvDashboardId" = ${PRODUCTION_SCHEDULE_DASHBOARD_ID}
      AND "pp"."fhincd" = ("CsvDashboardRow"."rowData"->>'FHINCD')
    LEFT JOIN "ProductionScheduleOrderSupplement" AS "supplement"
      ON "supplement"."csvDashboardRowId" = "CsvDashboardRow"."id"
      AND "supplement"."csvDashboardId" = ${PRODUCTION_SCHEDULE_DASHBOARD_ID}
    LEFT JOIN "ProductionScheduleFkojunstStatus" AS "fkst"
      ON "fkst"."csvDashboardRowId" = "CsvDashboardRow"."id"
      AND "fkst"."csvDashboardId" = ${PRODUCTION_SCHEDULE_DASHBOARD_ID}
    LEFT JOIN "ProductionScheduleFkojunstMailStatus" AS "fkmail"
      ON "fkmail"."csvDashboardRowId" = "CsvDashboardRow"."id"
      AND "fkmail"."csvDashboardId" = ${PRODUCTION_SCHEDULE_DASHBOARD_ID}
    WHERE ${commonWhere}
      ${excludeSql}
    ORDER BY
      ${dueSortExpr} ASC NULLS LAST,
      ("CsvDashboardRow"."rowData"->>'FSEIBAN') ASC,
      ("CsvDashboardRow"."rowData"->>'ProductNo') ASC,
      (CASE
        WHEN ("CsvDashboardRow"."rowData"->>'FKOJUN') ~ '^\\d+$' THEN (("CsvDashboardRow"."rowData"->>'FKOJUN'))::int
        ELSE NULL
      END) ASC NULLS LAST,
      ("CsvDashboardRow"."rowData"->>'FHINCD') ASC
    LIMIT ${fillLimit}
  `;

  return sortLeaderboardFetchRows([...selected, ...fillerRows]);
}

/** @internal exported for tests */
export function compareLeaderboardFetchedRows(
  a: LeaderboardScheduleRowSql,
  b: LeaderboardScheduleRowSql
): number {
  const aMan = a.processingOrder != null;
  const bMan = b.processingOrder != null;
  if (aMan !== bMan) return aMan ? -1 : 1;
  if (aMan && bMan && a.processingOrder !== b.processingOrder) {
    return (a.processingOrder ?? 0) - (b.processingOrder ?? 0);
  }
  const aDue = dueTime(a);
  const bDue = dueTime(b);
  if (aDue !== bDue) {
    if (aDue == null) return 1;
    if (bDue == null) return -1;
    return aDue - bDue;
  }
  const af = readFseibanFromRow(a);
  const bf = readFseibanFromRow(b);
  const c = af.localeCompare(bf, 'ja');
  if (c !== 0) return c;
  const ad = (a.rowData ?? {}) as Record<string, unknown>;
  const bd = (b.rowData ?? {}) as Record<string, unknown>;
  const ap = typeof ad.ProductNo === 'string' ? ad.ProductNo : '';
  const bp = typeof bd.ProductNo === 'string' ? bd.ProductNo : '';
  const pc = ap.localeCompare(bp, 'ja');
  if (pc !== 0) return pc;
  return a.id.localeCompare(b.id);
}

function dueTime(row: LeaderboardScheduleRowSql): number | null {
  const d = row.dueDate;
  if (d) return new Date(d).getTime();
  const e = row.plannedEndDate;
  if (e) return new Date(e).getTime();
  return null;
}

function sortLeaderboardFetchRows(rows: LeaderboardScheduleRowSql[]): LeaderboardScheduleRowSql[] {
  return [...rows].sort(compareLeaderboardFetchedRows);
}
