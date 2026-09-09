/** キオスク研削順位ボードのページ専用API契約。既存順位ボードの順位・割当とは別管理。 */
export type GrindingPlanningBoardView = 'seiban' | 'resource';
export type GrindingPlanningBoardCategory = 'grinding' | 'cutting';

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

export interface GrindingPlanningBoardSeibanOrderRequest {
  sourceRevision: string;
  fseibans: string[];
}
