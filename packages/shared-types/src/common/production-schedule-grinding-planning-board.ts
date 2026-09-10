/** キオスク研削順位ボードのページ専用API契約。既存順位ボードの順位・割当とは別管理。 */
export type GrindingPlanningBoardView = 'seiban' | 'resource';
export type GrindingPlanningBoardCategory = 'grinding' | 'cutting';

export type GrindingPlanningBoardDueScope =
  | { kind: 'seiban' }
  | { kind: 'processing'; processingType: string };

export interface GrindingPlanningBoardDueDetailProcess {
  rowId: string;
  resourceCd: string;
  resourceNames?: string[];
  processOrder: number | null;
  isCompleted: boolean;
}

export interface GrindingPlanningBoardDueDetailPart {
  productNo: string;
  fhincd: string;
  fhinmei: string;
  note: string | null;
  processCount: number;
  totalRequiredMinutes: number;
  processingType: string | null;
  processingPriority: number;
  completedProcessCount: number;
  totalProcessCount: number;
  actualPerPieceMinutes: number | null;
  actualEstimatedMinutes: number;
  actualCoverageRatio: number;
  processes: GrindingPlanningBoardDueDetailProcess[];
  currentPriorityRank: number | null;
  suggestedPriorityRank: number;
  plannedQuantity?: number | null;
  plannedStartDate?: string | null;
  plannedEndDate?: string | null;
  effectiveDueDate?: string | null;
  effectiveDueDateSource?: 'manual' | 'csv' | null;
}

export interface GrindingPlanningBoardDueDetail {
  fseiban: string;
  machineName: string | null;
  dueDate: string | null;
  parts: GrindingPlanningBoardDueDetailPart[];
  processingTypeDueDates?: Array<{ processingType: string; dueDate: string | null }>;
}

export interface GrindingPlanningBoardDueScopeSnapshot {
  original: GrindingPlanningBoardDueDetail;
  alternate: GrindingPlanningBoardDueDetail;
  sourceGenerationToken: string;
  scopeRevision: string;
}

export interface GrindingPlanningBoardDueScopeRequest {
  sourceGenerationToken: string;
  scopeRevision: string;
  scope: GrindingPlanningBoardDueScope;
  dueDate: string;
}

export type GrindingPlanningBoardDueRequest =
  | { kind: 'date'; date: string }
  | { kind: 'offsetDays'; days: number }
  | { kind: 'restore' };

export type GrindingPlanningBoardItemKind = 'row' | 'split';

export interface GrindingPlanningBoardItem {
  itemId: string;
  kind: GrindingPlanningBoardItemKind;
  itemRevision: string;
  version: number;
  sourceRowId: string;
  fseiban: string;
  fhincd: string;
  fhinmei: string | null;
  machineName: string | null;
  productNo: string;
  processOrder: string;
  originalResourceCd: string | null;
  effectiveResourceCd: string | null;
  originalDueDate: string | null;
  effectiveDueDate: string | null;
  originalRank: number | null;
  alternateRank: number | null;
  plannedQuantity: number | null;
  requiredMinutes: number | null;
  requiredMinutesKnown: boolean;
  isCompleted: boolean;
  progress: { completed: number; total: number; quantityKnown: boolean };
}

export interface GrindingPlanningBoardLoad {
  resourceCd: string;
  originalItemCount: number;
  alternateItemCount: number;
  originalRequiredMinutes: number | null;
  alternateRequiredMinutes: number | null;
  unfinishedItemCount: number;
  requiredMinutes: number | null;
  unknownItemCount: number;
  originalUnknownItemCount: number;
  alternateUnknownItemCount: number;
}

export interface GrindingPlanningBoardResponse {
  siteKey: string;
  category: GrindingPlanningBoardCategory;
  view: GrindingPlanningBoardView;
  sourceRevision: string;
  boardVersion: number;
  registeredFseibans: string[];
  seibanOrder: string[];
  resources: string[];
  items: GrindingPlanningBoardItem[];
  load: GrindingPlanningBoardLoad[];
  unknownRequiredMinutesCount: number;
  seibanProgress: Record<string, { completed: number; total: number }>;
  snapshotId: string;
  nextCursor: string | null;
}

export interface GrindingPlanningBoardOverridesResponse {
  sourceRevision: string;
  items: GrindingPlanningBoardItem[];
}

export interface GrindingPlanningBoardOverrideItemRequest {
  itemId: string;
  itemRevision: string;
  overrideVersion?: number;
  resourceCd?: string | null;
  due?: GrindingPlanningBoardDueRequest;
}

export interface GrindingPlanningBoardOverridesRequest {
  sourceRevision: string;
  items: GrindingPlanningBoardOverrideItemRequest[];
}

export interface GrindingPlanningBoardRankRequest {
  sourceRevision: string;
  itemId: string;
  itemRevision: string;
  overrideVersion?: number;
  alternateRank: number | null;
}

export interface GrindingPlanningBoardRankResponse {
  sourceRevision: string;
  itemId: string;
  itemRevision: string;
  overrideVersion: number;
  alternateRank: number | null;
}

export interface GrindingPlanningBoardSeibanOrderRequest {
  sourceRevision: string;
  fseibans: string[];
}

/** 研削順位ボードの製番登録ペインに表示する納期範囲候補。 */
export interface GrindingPlanningBoardSeibanCandidate {
  fseiban: string;
  machineName: string | null;
  dueDate: string;
  completedProcessCount: number;
  totalProcessCount: number;
  isCompleted: boolean;
}

export interface GrindingPlanningBoardSeibanCandidatesResponse {
  today: string;
  rangeStart: string;
  rangeEnd: string;
  completionFilter: 'all' | 'incomplete';
  candidates: GrindingPlanningBoardSeibanCandidate[];
}
