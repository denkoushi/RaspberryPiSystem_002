import { Prisma } from '@prisma/client';

import { buildBoardDueDateSql } from '../d-schedule-minutes/board-due.sql.js';
import type { BoardDueSource } from '../d-schedule-minutes/resolve-board-due-date.js';

/**
 * 着手日・平準化クエリの期間フィルタ。
 * - 着手日または有効納期が欠損 → **期間外判定せず通す**（Assembler で未配分表示）
 * - 両方ある → 着手〜納期が [rangeStart, rangeEndExclusive) と交差する行のみ
 * - `includeOverdueBefore` 指定時 → 有効納期がその日より前の行（納期遅れの残）も通す
 *
 * dueSource で選択したボード有効納期を使用。
 * 前提 JOIN: `supplement`, `n`, BOARD_DUE_JOINS_SQL
 */
export function buildStartDateLevelingQueryWindowWhereSql(params: {
  dueSource: BoardDueSource;
  rangeStart: Date;
  rangeEndExclusive: Date;
  includeOverdueBefore?: Date;
}): Prisma.Sql {
  const overdueSql = params.includeOverdueBefore
    ? Prisma.sql`OR ${buildBoardDueDateSql(params.dueSource)} < ${params.includeOverdueBefore}`
    : Prisma.empty;
  return Prisma.sql`
    AND (
      "supplement"."plannedStartDate" IS NULL
      OR ${buildBoardDueDateSql(params.dueSource)} IS NULL
      ${overdueSql}
      OR (
        "supplement"."plannedStartDate" < ${params.rangeEndExclusive}
        AND ${buildBoardDueDateSql(params.dueSource)} >= ${params.rangeStart}
      )
    )
  `;
}
