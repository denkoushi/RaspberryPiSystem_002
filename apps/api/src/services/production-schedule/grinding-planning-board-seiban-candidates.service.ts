import { Prisma } from '@prisma/client';
import type {
  GrindingPlanningBoardCategory,
  GrindingPlanningBoardSeibanCandidate,
  GrindingPlanningBoardSeibanCandidatesResponse
} from '@raspi-system/shared-types';

import { prisma } from '../../lib/prisma.js';
import {
  PRODUCTION_SCHEDULE_DASHBOARD_ID,
  SEIBAN_MACHINE_NAME_UNREGISTERED_LABEL
} from './constants.js';
import { buildProductionScheduleEffectiveCompletedSql } from './production-schedule-effective-completion.sql.js';
import { buildResourceCategoryCondition } from './production-schedule-query/filters.js';
import { getResourceCategoryPolicy } from './policies/resource-category-policy.service.js';
import { resolveSeibanMachineDisplayNamesBatched } from './seiban-machine-display-names.service.js';
import { resolveLeaderboardMaterializedBaseWhere } from './row-resolver/index.js';

type CandidateRow = {
  fseiban: string;
  dueDate: Date;
  completedProcessCount: bigint;
  totalProcessCount: bigint;
};

const dateFromYmd = (value: string): Date => new Date(`${value}T00:00:00.000Z`);

const ymd = (value: Date): string => value.toISOString().slice(0, 10);

const daysInMonth = (year: number, monthIndex: number): number =>
  new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate();

const shiftCalendarMonth = (todayYmd: string, offset: number): string => {
  const [year, month, day] = todayYmd.split('-').map(Number);
  const target = new Date(Date.UTC(year, month - 1 + offset, 1));
  const clampedDay = Math.min(day, daysInMonth(target.getUTCFullYear(), target.getUTCMonth()));
  return new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth(), clampedDay))
    .toISOString()
    .slice(0, 10);
};

export function todayJstYmd(now: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Tokyo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(now);
  const values = new Map(parts.map((part) => [part.type, part.value]));
  return `${values.get('year')}-${values.get('month')}-${values.get('day')}`;
}

export function resolveSeibanCandidateDateRange(today: string): { rangeStart: string; rangeEnd: string } {
  return {
    rangeStart: shiftCalendarMonth(today, -1),
    rangeEnd: shiftCalendarMonth(today, 1)
  };
}

export async function getGrindingPlanningBoardSeibanCandidates(params: {
  siteKey: string;
  category: GrindingPlanningBoardCategory;
  completionFilter?: 'all' | 'incomplete';
  now?: Date;
}): Promise<GrindingPlanningBoardSeibanCandidatesResponse> {
  const today = todayJstYmd(params.now);
  const { rangeStart, rangeEnd } = resolveSeibanCandidateDateRange(today);
  const completionFilter = params.completionFilter ?? 'incomplete';
  const [baseWhere, policy] = await Promise.all([
    resolveLeaderboardMaterializedBaseWhere(prisma),
    getResourceCategoryPolicy({ siteKey: params.siteKey })
  ]);
  const categoryCondition = buildResourceCategoryCondition(params.category, policy);
  const dueExpression = Prisma.sql`COALESCE("seibanDue"."dueDate", "n"."dueDate", "supplement"."plannedEndDate")`;
  const incompleteHaving = completionFilter === 'incomplete'
    ? Prisma.sql`AND SUM(CASE WHEN ${buildProductionScheduleEffectiveCompletedSql()} THEN 1 ELSE 0 END) < COUNT(*)`
    : Prisma.empty;

  const rows = await prisma.$queryRaw<CandidateRow[]>(Prisma.sql`
    SELECT
      BTRIM("CsvDashboardRow"."rowData"->>'FSEIBAN') AS "fseiban",
      MIN(${dueExpression}) AS "dueDate",
      SUM(CASE WHEN ${buildProductionScheduleEffectiveCompletedSql()} THEN 1 ELSE 0 END)::bigint AS "completedProcessCount",
      COUNT(*)::bigint AS "totalProcessCount"
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
    LEFT JOIN "ProductionScheduleOrderSupplement" AS "supplement"
      ON "supplement"."csvDashboardRowId" = "CsvDashboardRow"."id"
      AND "supplement"."csvDashboardId" = ${PRODUCTION_SCHEDULE_DASHBOARD_ID}
    LEFT JOIN "ProductionScheduleSeibanDueDate" AS "seibanDue"
      ON "seibanDue"."fseiban" = BTRIM("CsvDashboardRow"."rowData"->>'FSEIBAN')
      AND "seibanDue"."csvDashboardId" = ${PRODUCTION_SCHEDULE_DASHBOARD_ID}
    WHERE ${baseWhere}
      AND NULLIF(BTRIM("CsvDashboardRow"."rowData"->>'FSEIBAN'), '') IS NOT NULL
      ${categoryCondition}
    GROUP BY BTRIM("CsvDashboardRow"."rowData"->>'FSEIBAN')
    HAVING MIN(${dueExpression}) >= ${dateFromYmd(rangeStart)}
      AND MIN(${dueExpression}) <= ${dateFromYmd(rangeEnd)}
      ${incompleteHaving}
    ORDER BY MIN(${dueExpression}) ASC, BTRIM("CsvDashboardRow"."rowData"->>'FSEIBAN') ASC
  `);

  const machineNames = await resolveSeibanMachineDisplayNamesBatched(rows.map((row) => row.fseiban));
  const candidates: GrindingPlanningBoardSeibanCandidate[] = rows.map((row) => {
    const completedProcessCount = Number(row.completedProcessCount);
    const totalProcessCount = Number(row.totalProcessCount);
    return {
      fseiban: row.fseiban,
      machineName: machineNames.machineNames[row.fseiban] === SEIBAN_MACHINE_NAME_UNREGISTERED_LABEL
        ? null
        : machineNames.machineNames[row.fseiban] ?? null,
      dueDate: ymd(row.dueDate),
      completedProcessCount,
      totalProcessCount,
      isCompleted: totalProcessCount > 0 && completedProcessCount === totalProcessCount
    };
  });

  return { today, rangeStart, rangeEnd, completionFilter, candidates };
}
