import type { Prisma } from '@prisma/client';

/**
 * `listProductionScheduleRows` と同一形状（enrich 前）の行。
 * responseProfile=leaderboard 専用の優先取得で使用する。
 */
export type LeaderboardScheduleRowSql = {
  id: string;
  seibanJoinKey: string | null;
  occurredAt: Date;
  updatedAt: Date | null;
  rowData: Prisma.JsonValue;
  processingOrder: number | null;
  globalRank: number | null;
  note: string | null;
  processingType: string | null;
  dueDate: Date | null;
  plannedQuantity: number | null;
  plannedStartDate: Date | null;
  plannedEndDate: Date | null;
  /** Optional planning detail payload for the shared source adapter. */
  planningDetail?: {
    detailUpdatedAt: Date | null;
    progressUpdatedAt: Date | null;
    externalUpdatedAt: Date | null;
    dueDate: Date | null;
    plannedQuantity: number | null;
    plannedEndDate: Date | null;
    isCompleted: boolean;
    isExternallyCompleted: boolean;
    splits: Array<{
      id: string;
      splitQuantity: number;
      dueDate: Date | null;
      updatedAt: Date;
    }>;
  };
};
