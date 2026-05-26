import { Prisma } from '@prisma/client';

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
