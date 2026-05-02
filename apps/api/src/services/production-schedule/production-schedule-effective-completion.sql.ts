import { Prisma } from '@prisma/client';

/**
 * キオスク完了表示の実効値（手動完了 OR CSV由来外部完了）。
 * 利用側で LEFT JOIN:
 * - "ProductionScheduleProgress" AS "p" ON p.csvDashboardRowId = … AND p.csvDashboardId = …
 * - "ProductionScheduleExternalCompletion" AS "ext" ON ext.csvDashboardRowId = … AND ext.csvDashboardId = …
 */
export function buildProductionScheduleEffectiveCompletedSql(): Prisma.Sql {
  return Prisma.sql`(COALESCE("p"."isCompleted", FALSE) OR COALESCE("ext"."isExternallyCompleted", FALSE))`;
}
