export const PLANNING_BOARD_MAX_DUE_OFFSET_DAYS = 3650;

/** キオスク研削順位ボードのページ専用API契約。既存順位ボードの順位・割当とは別管理。 */
export type GrindingPlanningBoardView = 'seiban' | 'resource';
export type GrindingPlanningBoardCategory = 'grinding' | 'cutting' | 'all';
export type GrindingPlanningBoardScheduleSource = 'general' | 'dCompany' | 'both';

export interface GrindingPlanningBoardProcessChipsRequest {
  parts: Array<{ fseiban: string; productNo: string; fhincd: string }>;
}

export interface GrindingPlanningBoardProcessChipsResponse {
  /** Trimmed fseiban, productNo, fhincd joined with NUL. */
  chipsByPartKey: Record<string, Array<{
    rowId: string;
    resourceCd: string;
    resourceNames?: string[];
    isCompleted: boolean;
  }>>;
}

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

export type GrindingPlanningBoardSpecialDueKind = 'today' | 'overnight';

export interface GrindingPlanningBoardSpecialDue {
  kind: GrindingPlanningBoardSpecialDueKind;
  expiresAt: string;
}

export type GrindingPlanningBoardItemKind = 'row' | 'piece';

/**
 * 材料（鋳物・鋼材など）の入荷状況。購買CSV `FKOBAIST` 由来。
 * received=全数入荷済 / partial=一部入荷済 / ordered=注文済・未入荷 / unordered=未発注。
 */
export type MaterialArrivalStatus = 'received' | 'partial' | 'ordered' | 'unordered';
export type MaterialArrivalBasis = 'material' | 'part';

export interface GrindingPlanningBoardItem {
  /** Read-only status-mail process absent from the schedule CSV. */
  standardHoursMissing?: boolean;
  itemId: string;
  kind: GrindingPlanningBoardItemKind;
  itemRevision: string;
  version: number;
  sourceRowId: string;
  parentItemId?: string;
  pieceId?: string;
  sourcePieceId?: string;
  sourceItemId?: string;
  opSplitSourceResourceCd?: string | null;
  opRange?: { fromOpNo: number; toOpNo: number } | null;
  isLaterProcess?: boolean;
  piecePosition?: number;
  pieceSetVersion?: number;
  quantity?: number;
  parentPlannedQuantity?: number | null;
  quantityWarning?: SessakuPieceQuantityWarning | null;
  manualIsCompleted?: boolean;
  unitRequiredMinutes?: number | null;
  setupMinutes?: number;
  ops?: GrindingPlanningBoardResourcePartOpMinutes[];
  completedOpNos?: number[];
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
  specialDue?: GrindingPlanningBoardSpecialDue | null;
  orderPinned?: boolean;
  plannedQuantity: number | null;
  requiredMinutes: number | null;
  requiredMinutesKnown: boolean;
  originalRequiredMinutes: number | null;
  ownRequiredMinutes: number | null;
  requiredMinutesSource: GrindingPlanningBoardRequiredMinutesSource;
  isCompleted: boolean;
  lslhSurface: boolean;
  arrived?: boolean;
  isFirstProcess?: boolean;
  firstProcessState?: GrindingPlanningBoardFirstProcessState;
  manualArrivalDate?: string | null;
  completionSource?: 'manual' | 'import' | null;
  progress: { completed: number; total: number; quantityKnown: boolean };
  /** 材料の購買行が無い部品は null / 省略 */
  materialArrivalStatus?: MaterialArrivalStatus | null;
  materialArrivalBasis?: MaterialArrivalBasis;
  placement?: { shelves: { shelfCodeRaw: string; label: string; placedAt: string }[] } | null;
}

/** CSV・製番・品番を持たない独立した加工棒。 */
export interface GrindingPlanningBoardTestBar {
  kind: 'test';
  itemId: string;
  itemRevision: string;
  version: number;
  sequence: number;
  name: string;
  resourceCd: string;
  minutes: number;
  alternateRank: number;
  isCompleted: boolean;
  completedAt: string | null;
  deletedAt: string | null;
}
export type GrindingPlanningBoardBar = GrindingPlanningBoardItem | GrindingPlanningBoardTestBar;
export interface GrindingPlanningBoardItemReference {
  itemId: string;
  itemRevision: string;
  overrideVersion?: number;
}
export interface GrindingPlanningBoardTestBarCreateRequest {
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

export interface GrindingPlanningBoardLoadResponse {
  load: GrindingPlanningBoardLoad[];
  unknownRequiredMinutesCount: number;
}

export interface GrindingPlanningBoardResponse {
  dueSource?: 'excel' | 'scaw';
  pieceCapabilities?: { createEnabled: boolean; includePieces: boolean };
  siteKey: string;
  category: GrindingPlanningBoardCategory;
  view: GrindingPlanningBoardView;
  sourceRevision: string;
  boardVersion: number;
  registeredFseibans: string[];
  excelNonMachineFseibans?: string[];
  uncheckedFseibans: string[];
  seibanOrder: string[];
  resources: string[];
  resourceCategories?: Record<string, 'grinding' | 'cutting'>;
  items: GrindingPlanningBoardItem[];
  testBars?: GrindingPlanningBoardTestBar[];
  nextTestBarSequence?: number;
  load: GrindingPlanningBoardLoad[];
  unknownRequiredMinutesCount: number;
  loadDeferred?: boolean;
  seibanProgress: Record<string, { completed: number; total: number }>;
  /** 登録済み製番すべての機種表示名（その区分に工程が無い製番も含む） */
  machineNames?: Record<string, string | null>;
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

/** 製番登録ペインに表示する、期間内の製番候補。 */
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

/** ガント表示で棒の長さを決める、資源CDごとの1日あたり稼働時間。サイト共有。 */
export const GRINDING_PLANNING_BOARD_RESOURCE_DAILY_HOURS = [8, 10, 24] as const;
export type GrindingPlanningBoardResourceDailyHours = (typeof GRINDING_PLANNING_BOARD_RESOURCE_DAILY_HOURS)[number];
export const GRINDING_PLANNING_BOARD_DEFAULT_RESOURCE_DAILY_HOURS: GrindingPlanningBoardResourceDailyHours = 8;

/** 既定値(8時間)以外が保存された資源CDだけを返す。 */
export interface GrindingPlanningBoardResourceCapacityResponse {
  dailyHoursByResource: Record<string, GrindingPlanningBoardResourceDailyHours>;
  runsThroughBreaksResources: string[];
  /** 021/022 and stored resources; absent 021/022 default to true, other absent resources to false. */
  unitSplitEnabledByResource?: Record<string, boolean>;
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

export type GrindingPlanningBoardFirstProcessState = 'arrived' | 'excluded' | null;

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

export type SessakuPieceQuantityWarning = 'COMPLETED_QUANTITY_EXCEEDS_PLAN' | 'INVALID_PLANNED_QUANTITY';
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

export type GrindingPlanningBoardRequiredMinutesSource = 'original' | 'own';
export interface GrindingPlanningBoardResourceMinutesResponse {
  ownSourceResourceCds: string[];
  values: Array<{ resourceCd: string; fhincd: string; perUnitMinutes: number; setupMinutes: number; ops?: GrindingPlanningBoardResourcePartOpMinutes[] }>;
  /** Updated row's operations read within the save transaction, in matching order. */
  savedOpIds?: string[];
  savedOpNos?: number[];
  /** Values committed by this save, before the subsequent settings read; null after deletion. */
  savedMinutes?: GrindingPlanningBoardResourcePartMinutesSnapshot | null;
}
export interface GrindingPlanningBoardResourceMinutesSourceRequest {
  resourceCd: string;
  source: GrindingPlanningBoardRequiredMinutesSource;
}
export interface GrindingPlanningBoardResourcePartMinutesSnapshot {
  perUnitMinutes: number;
  setupMinutes: number;
  ops: Array<{ opNo: number; minutes: number; setupMinutes: number | null }>;
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

export interface GrindingPlanningBoardResourcePartOpMinutes {
  id?: string;
  setupMinutes?: number | null;
  opNo: number;
  minutes: number;
}
export interface SessakuPiecesAutoUnitSplitResponse {
  splitCount: number;
  skippedCount: number;
  hasMore: boolean;
}
export type SessakuPieceOpCompletionRequest = SessakuPieceCompletionRequest;
