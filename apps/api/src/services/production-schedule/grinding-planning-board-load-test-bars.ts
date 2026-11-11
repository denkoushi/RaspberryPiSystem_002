import { Prisma } from '@prisma/client';

import { PRODUCTION_SCHEDULE_DASHBOARD_ID } from './constants.js';

import type { GrindingPlanningBoardLoadSummary, ReadGrindingPlanningBoardLoadSummaryParams } from './grinding-planning-board-load-summary.js';

/** Adds unfinished, undeleted test bars to their machine's load (both original and alternate totals). */
export async function addPlanningTestBarLoad(summary: GrindingPlanningBoardLoadSummary, params: ReadGrindingPlanningBoardLoadSummaryParams): Promise<GrindingPlanningBoardLoadSummary> {
  const tests = await params.client.$queryRaw<Array<{ resourceCd: string; minutes: number; count: number }>>(Prisma.sql`
    SELECT "resourceCd", SUM("minutes")::double precision AS "minutes", COUNT(*)::integer AS "count"
    FROM "ProductionScheduleGrindingPlanningBoardTestBar"
    WHERE "csvDashboardId" = ${params.dashboardId ?? PRODUCTION_SCHEDULE_DASHBOARD_ID}
      AND "siteKey" = ${params.siteKey} AND "deletedAt" IS NULL AND "completedAt" IS NULL
    GROUP BY "resourceCd"
  `);
  const loads = new Map(summary.load.map((entry) => [entry.resourceCd, { ...entry }]));
  for (const test of tests) {
    if (!params.isResourceInCategory(test.resourceCd, params.category)) continue;
    const entry = loads.get(test.resourceCd) ?? { resourceCd: test.resourceCd, originalItemCount: 0, alternateItemCount: 0,
      originalRequiredMinutes: 0, alternateRequiredMinutes: 0, unfinishedItemCount: 0, requiredMinutes: 0,
      unknownItemCount: 0, originalUnknownItemCount: 0, alternateUnknownItemCount: 0 };
    entry.originalItemCount += test.count; entry.alternateItemCount += test.count;
    entry.unfinishedItemCount += test.count;
    entry.originalRequiredMinutes = (entry.originalRequiredMinutes ?? 0) + test.minutes;
    entry.alternateRequiredMinutes = (entry.alternateRequiredMinutes ?? 0) + test.minutes;
    entry.requiredMinutes = entry.alternateRequiredMinutes;
    loads.set(test.resourceCd, entry);
  }
  return { ...summary, load: [...loads.values()].sort((a, b) => a.resourceCd.localeCompare(b.resourceCd)) };
}
