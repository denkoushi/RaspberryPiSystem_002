import type {
  GrindingPlanningBoardScheduleSource,
  GrindingPlanningBoardDueScope,
  GrindingPlanningBoardSpecialDueKind,
  GrindingPlanningBoardItem,
  GrindingPlanningBoardTestBar,
  GrindingPlanningBoardResourceDailyHours,
  GrindingPlanningBoardFirstProcessState,
  SessakuPieceQuantityWarning,
  GrindingPlanningBoardRequiredMinutesSource,
  ProductionScheduleSameModelResourceGroup,
  GrindingPlanningBoardResourcePartMinutesSnapshot,
  GrindingPlanningBoardResourcePartOpMinutes,
} from './production-schedule-grinding-planning-board.js';

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
export interface GrindingPlanningBoardItemReference {
  itemId: string;
  itemRevision: string;
  overrideVersion?: number;
}
export interface GrindingPlanningBoardTestBarPartCandidatesResponse {
  parts: Array<{ partName: string; machineStock: boolean }>;
}
export interface GrindingPlanningBoardTestBarCreateRequest {
  partName?: string | null;
  sourceRevision: string;
  dueSource?: 'excel' | 'scaw';
  resourceCd: string;
  minutes: number;
  afterItem?: GrindingPlanningBoardItemReference;
}
export interface GrindingPlanningBoardTestBarMutationRequest {
  restoreAfterItemId?: string | null;
  dueSource?: 'excel' | 'scaw';
  sourceRevision: string;
  expectedVersion: number;
}
export interface GrindingPlanningBoardTestBarMutationResponse {
  sourceRevision: string;
  testBar: GrindingPlanningBoardTestBar;
  testBars: GrindingPlanningBoardTestBar[];
  items: GrindingPlanningBoardItem[];
  nextTestBarSequence: number;
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
  specialDue?: GrindingPlanningBoardSpecialDueKind | null;
}

export interface GrindingPlanningBoardOverridesRequest {
  dueSource?: 'excel' | 'scaw';
  sourceRevision: string;
  items: GrindingPlanningBoardOverrideItemRequest[];
}

export interface GrindingPlanningBoardPinsRequest {
  dueSource?: 'excel' | 'scaw';
  sourceRevision: string;
  items: { itemId: string; itemRevision: string; overrideVersion?: number }[];
  pinned: boolean;
}

export interface GrindingPlanningBoardRankRequest {
  dueSource?: 'excel' | 'scaw';
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

export type GrindingPlanningBoardResourceOrderPlacement = 'before' | 'after';

export interface GrindingPlanningBoardResourceOrderRequest {
  dueSource?: 'excel' | 'scaw';
  scheduleSource?: GrindingPlanningBoardScheduleSource;
  sourceRevision: string;
  itemId: string;
  itemRevision: string;
  overrideVersion?: number;
  targetItemId: string;
  targetItemRevision: string;
  targetOverrideVersion?: number;
  placement: GrindingPlanningBoardResourceOrderPlacement;
}

export interface GrindingPlanningBoardResourceOrderBulkRequest {
  dueSource?: 'excel' | 'scaw';
  scheduleSource?: GrindingPlanningBoardScheduleSource;
  sourceRevision: string;
  resourceCd: string;
  items: { itemId: string; itemRevision: string; overrideVersion?: number }[];
}

export interface GrindingPlanningBoardResourceMoveRequest {
  dueSource?: 'excel' | 'scaw';
  scheduleSource?: GrindingPlanningBoardScheduleSource;
  sourceRevision: string;
  move: { itemId: string; itemRevision: string; overrideVersion?: number; resourceCd: string };
  items: { itemId: string; itemRevision: string; overrideVersion?: number }[];
}

export interface GrindingPlanningBoardResourceMoveResponse {
  sourceRevision: string;
  items: GrindingPlanningBoardItem[];
}

export interface GrindingPlanningBoardResourceOrderResponse {
  testBars?: GrindingPlanningBoardTestBar[];
  sourceRevision: string;
  items: GrindingPlanningBoardItem[];
}

export interface GrindingPlanningBoardSeibanOrderRequest {
  sourceRevision: string;
  fseibans: string[];
}

export interface GrindingPlanningBoardSeibanChecksRequest {
  sourceRevision: string;
  uncheckedFseibans: string[];
}

export interface GrindingPlanningBoardSeibanChecksResponse {
  sourceRevision: string;
  uncheckedFseibans: string[];
}

export interface GrindingPlanningBoardResourceCapacityRequest {
  resourceCd: string;
  dailyHours?: GrindingPlanningBoardResourceDailyHours;
  runsThroughBreaks?: boolean;
  unitSplitEnabled?: boolean | null;
}

export interface GrindingPlanningBoardArrivalRequest {
  dueSource?: 'excel' | 'scaw';
  itemId: string;
  itemRevision: string;
  overrideVersion?: number;
}

export interface GrindingPlanningBoardFirstProcessArrivalRequest extends GrindingPlanningBoardArrivalRequest {
  state: GrindingPlanningBoardFirstProcessState;
}

export interface GrindingPlanningBoardFirstProcessArrivalResponse {
  itemId: string;
  firstProcessState: GrindingPlanningBoardFirstProcessState;
}

export interface GrindingPlanningBoardArrivalResponse {
  itemId: string;
  manualArrivalDate: string | null;
}
export interface SessakuPiecesSplitRequest {
  dueSource?: 'excel' | 'scaw';
  parentItemId: string;
  targetPieceId?: string;
  quantities: number[];
  expectedPieceSetVersion: number;
  itemRevision: string;
}
export interface SessakuPiecesMergeRequest {
  dueSource?: 'excel' | 'scaw';
  parentItemId: string;
  pieceIds: string[];
  expectedPieceSetVersion: number;
  itemRevisions: Record<string, string>;
}
export interface SessakuPieceOpSplitRequest {
  dueSource?: 'excel' | 'scaw';
  itemId: string;
  fromOpNo: number;
  expectedPieceSetVersion: number;
  itemRevision: string;
}
export type SessakuPieceOpMergeRequest = Omit<SessakuPieceOpSplitRequest, 'fromOpNo'>;
export interface SessakuPieceOpsConfigureRequest extends SessakuPieceOpMergeRequest {
  resourceCd: string;
  minutes: number[];
  expectedOpIds: string[];
  expectedMinutes: Exclude<GrindingPlanningBoardResourcePartMinutesRequest['expectedMinutes'], undefined>;
}
export interface SessakuPieceOpsClearRequest extends SessakuPieceOpMergeRequest {
  scope: 'piece' | 'set';
}
export type SessakuPieceOpsConfigureResponse = SessakuPiecesMutationResponse;
export type SessakuPieceOpsClearResponse = SessakuPiecesMutationResponse;
export type SessakuPieceOpSplitResponse = SessakuPiecesMutationResponse;
export type SessakuPieceOpMergeResponse = SessakuPiecesMutationResponse;

export interface SessakuPieceCompletionRequest {
  itemId?: string;
  dueSource?: 'excel' | 'scaw';
  intent: 'complete' | 'incomplete';
  expectedPieceSetVersion: number;
  itemRevision: string;
}
export interface SessakuPiecesMutationResponse {
  /** 変更前の ID（選択を外すためのもの） */
  affectedItemIds?: string[];
  parentItemId: string;
  pieceSetVersion: number;
  quantityWarning: SessakuPieceQuantityWarning | null;
  pieces: GrindingPlanningBoardItem[];
  parentIsCompleted: boolean;
  sourceRowId: string;
}
export interface KioskSameModelResourceGroupsRequest {
  groups: ProductionScheduleSameModelResourceGroup[];
  resolutions?: Record<string, string>;
}
export interface ProductionScheduleSameModelMinutesConflictDetails {
  fhincds: string[];
  values: Record<string, Record<string, {
    perUnitMinutes: number;
    setupMinutes: number;
    ops: Array<{ opNo: number; setupMinutes: number | null; minutes: number }>;
  }>>;
}
export interface GrindingPlanningBoardResourceMinutesSourceRequest {
  resourceCd: string;
  source: GrindingPlanningBoardRequiredMinutesSource;
}
export interface GrindingPlanningBoardResourcePartMinutesRequest {
  resourceCd: string;
  fhincd: string;
  perUnitMinutes: number | null;
  setupMinutes: number;
  ops?: GrindingPlanningBoardResourcePartOpMinutes[];
  expectedOpIds?: string[];
  /** Saved values when editing began; null means unregistered, omission keeps legacy behavior. */
  expectedMinutes?: GrindingPlanningBoardResourcePartMinutesSnapshot | null;
}
export interface SessakuPiecesAutoUnitSplitResponse {
  splitCount: number;
  skippedCount: number;
  hasMore: boolean;
}
export type SessakuPieceOpCompletionRequest = SessakuPieceCompletionRequest;
