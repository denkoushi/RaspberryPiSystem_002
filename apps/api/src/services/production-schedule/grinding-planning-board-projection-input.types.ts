import type { Prisma } from '@prisma/client';
import type {
  GrindingPlanningBoardResourceMinutesResponse,
  GrindingPlanningBoardResourceCapacityResponse,
  GrindingPlanningBoardCategory,
  GrindingPlanningBoardView
} from '@raspi-system/shared-types';

import type { BoardDueSource } from './d-schedule-minutes/resolve-board-due-date.js';
import type { MissingStandardHoursBoardRow } from './missing-standard-hours-process.js';
import type { SessakuPieceSet } from './sessaku-pieces/piece-key.js';

export type GrindingPlanningBoardRowData = Prisma.JsonValue | Record<string, unknown>;

export type GrindingPlanningBoardProjectionRow = {
  id: string;
  rowData: GrindingPlanningBoardRowData;
  updatedAt: Date | null;
};

export type GrindingPlanningBoardProjectionRowDetail = {
  manualUpdatedAt?: Date | null;
  excelDueDate?: Date | null;
  excelChangedAt?: Date | null;
  updatedAt: Date | null;
  rowNotes: ReadonlyArray<{ dueDate: Date | null }>;
  orderSupplements: ReadonlyArray<{
    plannedQuantity: number | null;
    plannedEndDate: Date | null;
  }>;
  productionScheduleProgress: { isCompleted: boolean; updatedAt: Date } | null;
  productionScheduleExternalCompletion: { isExternallyCompleted: boolean; updatedAt: Date } | null;
};

export type GrindingPlanningBoardProjectionRank = {
  resourceCd: string;
  orderNumber: number;
};

export type GrindingPlanningBoardProjectionRanks = {
  rows: ReadonlyMap<string, GrindingPlanningBoardProjectionRank>;
};

export type GrindingPlanningBoardProjectionOverride = {
  overrideResourceCd: string | null;
  overrideDueDate: Date | null;
  overrideDueDateSetAt?: Date | null;
  dueDateCleared?: boolean | null;
  orderPinned?: boolean;
  alternateRank: number | null;
  specialDueKind?: string | null;
  specialDueExpiresAt?: Date | null;
  version: number;
};

/**
 * 進捗の集計単位。呼び出し側は、カテゴリや完了フィルターを適用する前の
 * 全工程行を渡す。分割片はここへ渡さず、親の工程行を一度だけ渡す。
 */
export type GrindingPlanningBoardProgressRow = {
  rowId: string;
  fseiban: string;
  productNo: string;
  fhincd: string;
  isCompleted: boolean;
};

export type GrindingPlanningBoardProjectionInput = {
  missingStandardHoursRows?: readonly MissingStandardHoursBoardRow[];
  resourceMinutes?: GrindingPlanningBoardResourceMinutesResponse;
  resourceCapacity?: GrindingPlanningBoardResourceCapacityResponse;
  includePieces?: boolean;
  /** Transactional lane replacement needs ordering only, not revisions, progress summaries or load. */
  placementOnly?: boolean;
  pieceSets?: ReadonlyMap<string, SessakuPieceSet>;
  dueSource?: BoardDueSource;
  rows: readonly GrindingPlanningBoardProjectionRow[];
  details: ReadonlyMap<string, GrindingPlanningBoardProjectionRowDetail>;
  ranks: GrindingPlanningBoardProjectionRanks;
  overrides: ReadonlyMap<string, GrindingPlanningBoardProjectionOverride>;
  /** All logical source process rows, before category/completion filtering. */
  progressRows?: readonly GrindingPlanningBoardProgressRow[];
  category: GrindingPlanningBoardCategory;
  view?: GrindingPlanningBoardView;
  allocation?: 'original' | 'alternate';
  seibanOrder: readonly string[];
  selectedFseibans?: ReadonlySet<string>;
  machineNameBySeiban?: ReadonlyMap<string, string | null>;
  /** Resource-category policy is owned by the caller and remains outside this pure module. */
  isResourceInCategory?: (resourceCd: string, category: GrindingPlanningBoardCategory) => boolean;
};
