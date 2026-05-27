import { Prisma } from '@prisma/client';

/**
 * 着手日・平準化クエリの期間フィルタ。
 * - 着手日または有効納期が欠損 → **期間外判定せず通す**（Assembler で未配分表示）
 * - 両方ある → 着手〜納期が [rangeStart, rangeEndExclusive) と交差する行のみ
 *
 * 前提 JOIN: `supplement`, `n` (ProductionScheduleRowNote)
 */
export function buildStartDateLevelingQueryWindowWhereSql(params: {
  rangeStart: Date;
  rangeEndExclusive: Date;
}): Prisma.Sql {
  return Prisma.sql`
    AND (
      "supplement"."plannedStartDate" IS NULL
      OR COALESCE("n"."dueDate", "supplement"."plannedEndDate") IS NULL
      OR (
        "supplement"."plannedStartDate" < ${params.rangeEndExclusive}
        AND COALESCE("n"."dueDate", "supplement"."plannedEndDate") >= ${params.rangeStart}
      )
    )
  `;
}
