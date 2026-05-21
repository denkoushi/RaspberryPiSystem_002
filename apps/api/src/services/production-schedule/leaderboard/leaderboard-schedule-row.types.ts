import type { Prisma } from '@prisma/client';

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
