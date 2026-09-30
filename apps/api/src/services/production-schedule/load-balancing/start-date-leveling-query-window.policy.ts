import { Prisma } from '@prisma/client';

/**
 * 着手日・平準化クエリの期間フィルタ。
 * - 着手日または有効納期が欠損 → **期間外判定せず通す**（Assembler で未配分表示）
 * - 両方ある → 着手〜納期が [rangeStart, rangeEndExclusive) と交差する行のみ
 * - `includeOverdueBefore` 指定時 → 有効納期がその日より前の行（納期遅れの残）も通す
 *
 * 前提 JOIN: `supplement`, `n` (ProductionScheduleRowNote)
 */
export function buildStartDateLevelingQueryWindowWhereSql(params: {
  rangeStart: Date;
  rangeEndExclusive: Date;
  includeOverdueBefore?: Date;
}): Prisma.Sql {
  const overdueSql = params.includeOverdueBefore
    ? Prisma.sql`OR COALESCE("n"."dueDate", "supplement"."plannedEndDate") < ${params.includeOverdueBefore}`
    : Prisma.empty;
  return Prisma.sql`
    AND (
      "supplement"."plannedStartDate" IS NULL
      OR COALESCE("n"."dueDate", "supplement"."plannedEndDate") IS NULL
      ${overdueSql}
      OR (
        "supplement"."plannedStartDate" < ${params.rangeEndExclusive}
        AND COALESCE("n"."dueDate", "supplement"."plannedEndDate") >= ${params.rangeStart}
      )
    )
  `;
}
