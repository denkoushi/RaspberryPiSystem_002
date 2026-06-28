import { Prisma } from '@prisma/client';

import { PRODUCTION_SCHEDULE_DASHBOARD_ID } from './constants.js';

export type ProductionScheduleCompletionFilter = 'all' | 'complete' | 'incomplete';

/**
 * キオスク完了表示の実効値。
 * - 手動: `ProductionScheduleProgress.isCompleted`
 * - CSV外部: `ProductionScheduleExternalCompletion.isExternallyCompleted`
 *   （旧「メールキー消失」と生産日程CSV消失完了は廃止。**FKOJUNST_Status の C/X** のみ同期済み）
 *
 * 利用側で LEFT JOIN:
 * - "ProductionScheduleProgress" AS "p" ON …
 * - "ProductionScheduleExternalCompletion" AS "ext" ON …
 */
export function buildProductionScheduleEffectiveCompletedSql(): Prisma.Sql {
  return Prisma.sql`(COALESCE("p"."isCompleted", FALSE) OR COALESCE("ext"."isExternallyCompleted", FALSE))`;
}

export function buildProductionScheduleCompletionFilterWhereSql(
  completionFilter: ProductionScheduleCompletionFilter | undefined
): Prisma.Sql {
  switch (completionFilter ?? 'all') {
    case 'all':
      return Prisma.empty;
    case 'complete':
      return Prisma.sql`AND ${buildProductionScheduleEffectiveCompletedSql()}`;
    case 'incomplete':
      return Prisma.sql`AND NOT ${buildProductionScheduleEffectiveCompletedSql()}`;
  }
}

export function buildProductionScheduleCompletionFilterJoinSql(
  completionFilter: ProductionScheduleCompletionFilter | undefined
): Prisma.Sql {
  if ((completionFilter ?? 'all') === 'all') return Prisma.empty;
  return Prisma.sql`
    LEFT JOIN "ProductionScheduleProgress" AS "p"
      ON "p"."csvDashboardRowId" = "CsvDashboardRow"."id"
      AND "p"."csvDashboardId" = ${PRODUCTION_SCHEDULE_DASHBOARD_ID}
    LEFT JOIN "ProductionScheduleExternalCompletion" AS "ext"
      ON "ext"."csvDashboardRowId" = "CsvDashboardRow"."id"
      AND "ext"."csvDashboardId" = ${PRODUCTION_SCHEDULE_DASHBOARD_ID}
  `;
}
