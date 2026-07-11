import { api } from '../http';

import type { SelfInspectionStatus } from '../../features/part-measurement/types';
export interface ProductionScheduleRow {
  id: string;
  /** `ProductionScheduleProgressOverviewSeibanItem.seibanJoinKey` と突合する専用キー。 */
  seibanJoinKey?: string | null;
  occurredAt: string;
  rowData: Record<string, unknown>;
  processingOrder?: number | null;
  globalRank?: number | null;
  actualPerPieceMinutes?: number | null;
  resolvedMachineName?: string | null;
  customerName?: string | null;
  processingType?: string | null;
  note?: string | null;
  dueDate?: string | null;
  plannedQuantity?: number | null;
  plannedStartDate?: string | null;
  plannedEndDate?: string | null;
  /** `responseProfile=leaderboard` のとき。自主検査/部品測定テンプレ突合せ用 */
  partMeasurementProcessGroup?: 'cutting' | 'grinding';
  /** `responseProfile=leaderboard` のとき。自主検査開始用テンプレ ID */
  selfInspectionTemplateId?: string | null;
  hasSelfInspectionDrawing?: boolean;
  selfInspectionStatus?: SelfInspectionStatus | null;
  selfInspectionEntryPath?: string | null;
  /** 順位ボード: 機械行の FSIGENSHOYORYO（分）。`+人` OFF 時の表示基準。 */
  machineRequiredMinutes?: number;
  /** 順位ボード: 同一 ProductNo + FKOJUN の FSIGENCD=10 人工数（分）。 */
  laborRequiredMinutes?: number;
  /** キオスク順位ボード: 工程変更残骸疑い（通常グリッドには含めない） */
  processChangeResidualSuspected?: boolean;
  processChangeResidualEvidence?: ProcessChangeResidualEvidence;
  /** display item 契約: 親 CsvDashboardRow.id */
  sourceRowId?: string;
  splitId?: string | null;
  splitNo?: number | null;
  splitQuantity?: number | null;
  isSplit?: boolean;
}

export type ProcessChangeResidualEvidenceSide = {
  productNo: string;
  fkojun: string;
  resourceCd: string;
  status: string;
  fupdtedt: string | null;
};

export type ProcessChangeResidualEvidence = {
  current: ProcessChangeResidualEvidenceSide;
  completedOtherResource: ProcessChangeResidualEvidenceSide;
};

export interface ProductionScheduleListResponse {
  page: number;
  pageSize: number;
  /** 自主検査候補一覧など、全件数を返さない経路では省略 */
  total?: number;
  rows: ProductionScheduleRow[];
  /** `selfInspectionEligibleOnly` のとき。さらに候補がありうる */
  hasMore?: boolean;
  /**
   * `responseProfile=leaderboard` のときのみ。行下工程チップ用。
   */
  leaderboardFooterChipsByPartKey?: Record<
    string,
    Array<{
      rowId: string;
      resourceCd: string;
      resourceNames?: string[];
      isCompleted: boolean;
    }>
  >;
  /** キオスク順位ボード: 工程変更残骸疑い（通常 rows には含めない） */
  processChangeResidualTotal?: number;
  processChangeResidualRows?: ProductionScheduleRow[];
  processChangeResidualRepresentativeLimit?: number;
}

export type ProductionScheduleLeaderboardShellResponse = Pick<ProductionScheduleListResponse, 'page' | 'pageSize' | 'rows'> & {
  /** shell 応答で付与。continue で送信し軽量経路となる。 */
  snapshotId?: string;
  snapshotExpired?: boolean;
  /** 次の continue で送る cursor（これまでに返した行数）。 */
  nextCursor?: number;
  hasMore?: boolean;
};

export type ProductionScheduleLeaderboardTotalResponse = { total: number };

export type ProductionScheduleLeaderboardDecorationsResponse = {
  rowDecorations: Array<{
    id: string;
    resolvedMachineName: string | null;
    customerName: string | null;
    hasSelfInspectionDrawing: boolean;
    selfInspectionTemplateId: string | null;
    selfInspectionStatus: SelfInspectionStatus | null;
    selfInspectionEntryPath: string | null;
  }>;
  leaderboardFooterChipsByPartKey?: ProductionScheduleListResponse['leaderboardFooterChipsByPartKey'];
};

export type ProductionScheduleCompletionFilter = 'all' | 'complete' | 'incomplete';

export type KioskProductionScheduleLeaderboardPhasedQueryParams = {
  productNo?: string;
  q?: string;
  productNos?: string;
  resourceCds?: string;
  resourceAssignedOnlyCds?: string;
  resourceCategory?: 'grinding' | 'cutting';
  machineName?: string;
  hasNoteOnly?: boolean;
  hasDueDateOnly?: boolean;
  page?: number;
  pageSize?: number;
  allowResourceOnly?: boolean;
  completionFilter?: ProductionScheduleCompletionFilter;
  targetDeviceScopeKey?: string;
};

export interface ProductionScheduleResourceCategorySettings {
  location: string;
  cuttingExcludedResourceCds: string[];
}

export interface ProductionScheduleDueManagementAccessPasswordSettings {
  location: string;
  configured: boolean;
  defaultPasswordActive: boolean;
}

export interface ProductionScheduleOrderSplitPilotSettings {
  deploymentEnabled: boolean;
  runtimeEnabled: boolean;
  effectiveEnabled: boolean;
  updatedAt: string | null;
  updatedBy: string | null;
}

export interface ProductionScheduleProcessingTypeOption {
  code: string;
  label: string;
  priority: number;
  enabled: boolean;
}

export interface ProductionScheduleResourceCodeMapping {
  fromResourceCd: string;
  toResourceCd: string;
  priority: number;
  enabled: boolean;
}

export interface ProductionScheduleResourceCodeMappingsImportResult {
  location: string;
  dryRun: boolean;
  totalRows: number;
  rowsWithGroupCd: number;
  generatedMappings: number;
  skippedEmptyRows: number;
  skippedDuplicateRows: number;
  skippedUnknownResourceCds: string[];
  settings?: {
    location: string;
    mappings: ProductionScheduleResourceCodeMapping[];
  };
}

export interface ProductionScheduleLoadBalancingCapacityBaseItem {
  resourceCd: string;
  baseAvailableMinutes: number;
}

export interface ProductionScheduleLoadBalancingMonthlyCapacityItem {
  resourceCd: string;
  availableMinutes: number;
}

export interface ProductionScheduleLoadBalancingClassItem {
  resourceCd: string;
  classCode: string;
}

export interface ProductionScheduleLoadBalancingTransferRuleItem {
  fromClassCode: string;
  toClassCode: string;
  priority: number;
  enabled: boolean;
  efficiencyRatio: number;
}

export type ProductionScheduleLoadBalancingWorkCalendarMode = 'weekdays' | 'calendar_days';

export interface ProductionScheduleLoadBalancingWorkCalendarItem {
  resourceCd: string;
  workCalendarMode: ProductionScheduleLoadBalancingWorkCalendarMode;
}

export interface ProductionScheduleLoadBalancingOverviewResource {
  resourceCd: string;
  requiredMinutes: number;
  availableMinutes: number | null;
  overMinutes: number;
  classCode: string | null;
}

export interface ProductionScheduleLoadBalancingSuggestionItem {
  rowId: string;
  fseiban: string;
  productNo: string;
  fhincd: string;
  fkojun: string | null;
  resourceCdFrom: string;
  resourceCdTo: string;
  rowMinutes: number;
  estimatedReductionMinutesOnSource: number;
  estimatedBurdenMinutesOnDestination: number;
  simulatedSourceOverAfter: number;
  simulatedDestinationOverAfter: number;
  rulePriority: number;
  fromClassCode: string;
  toClassCode: string;
  efficiencyRatio: number;
}

export interface ProductionScheduleLoadBalancingOutsourcingCandidateItem {
  rowId: string;
  fseiban: string;
  productNo: string;
  fhincd: string;
  fkojun: string | null;
  resourceCd: string;
  rowMinutes: number;
  overReductionMinutes: number;
}

export interface ProductionScheduleLoadBalancingExternalizationCandidate {
  candidateId: string;
  fseiban: string;
  productNo: string;
  fhincd: string;
  fhinmei: string;
  operations: Array<{
    rowId: string;
    fseiban: string;
    productNo: string;
    fhincd: string;
    fhinmei: string;
    fkojun: string | null;
    resourceCd: string;
    requiredMinutes: number;
  }>;
  impactByResource: Array<{
    resourceCd: string;
    reducedMinutes: number;
    overReductionMinutes: number;
  }>;
  totalReducedMinutes: number;
  totalOverReductionMinutes: number;
  resolvesOverResourceCds: string[];
}

export interface ProductionScheduleLoadBalancingOutsourcingCandidatesResponse {
  siteKey: string;
  yearMonth: string;
  mode: 'outsourcing';
  resources: ProductionScheduleLoadBalancingOverviewResource[];
  candidates: ProductionScheduleLoadBalancingOutsourcingCandidateItem[];
  externalizationCandidates: ProductionScheduleLoadBalancingExternalizationCandidate[];
}

export interface ProductionScheduleLoadBalancingOutsourcingPlanResponse {
  siteKey: string;
  yearMonth: string;
  mode: 'outsourcing';
  strategy: 'max_over_reduction';
  selectedCandidateIds: string[];
  beforeResources: ProductionScheduleLoadBalancingOverviewResource[];
  afterResources: ProductionScheduleLoadBalancingOutsourcingSimulatedResource[];
  resolved: boolean;
  remainingOverMinutes: number;
  totalReducedMinutes: number;
  totalOverReductionMinutes: number;
}

export interface ProductionScheduleLoadBalancingOutsourcingReplacementsResponse {
  siteKey: string;
  yearMonth: string;
  mode: 'outsourcing';
  removeCandidateId: string;
  baseSelectedCandidateIds: string[];
  replacementOptions: Array<{
    candidateId: string;
    fseiban: string;
    productNo: string;
    fhincd: string;
    fhinmei: string;
    afterResources: ProductionScheduleLoadBalancingOutsourcingSimulatedResource[];
    resolved: boolean;
    remainingOverMinutes: number;
  }>;
}

export interface ProductionScheduleLoadBalancingOutsourcingSimulatedResource
  extends ProductionScheduleLoadBalancingOverviewResource {
  reducedMinutes: number;
}

export interface ProductionScheduleLoadBalancingOutsourcingSimulateResponse {
  siteKey: string;
  yearMonth: string;
  mode: 'outsourcing';
  beforeResources: ProductionScheduleLoadBalancingOverviewResource[];
  afterResources: ProductionScheduleLoadBalancingOutsourcingSimulatedResource[];
  appliedRows: Array<{
    rowId: string;
    fseiban: string;
    productNo: string;
    fhincd: string;
    fkojun: string | null;
    resourceCd: string;
    rowMinutes: number;
    reducedMinutes: number;
  }>;
  skippedRows: Array<{
    rowId: string;
    reason:
      | 'not_found'
      | 'duplicate'
      | 'zero_minutes'
      | 'resource_not_in_overview'
      | 'outside_over_resource_filter';
  }>;
  skippedCandidates?: Array<{
    candidateId: string;
    reason: 'not_found' | 'duplicate' | 'no_operations' | 'outside_over_resource_filter';
  }>;
  summary: {
    selectedCount: number;
    appliedCount: number;
    skippedCount: number;
    totalReducedMinutes: number;
    remainingOverMinutes: number;
  };
}

export interface ProductionScheduleLoadBalancingMachineSummary {
  machineName: string;
  fseibanCount: number;
  requiredMinutes: number;
}

export interface ProductionScheduleLoadBalancingMachinePartSummary {
  fhincd: string;
  fhinmei: string;
  productNos: string[];
  fseibans: string[];
  effectiveDueDateMin: string | null;
  totalRequiredMinutes: number;
  resourceCds: string[];
}

export interface ProductionScheduleLoadBalancingMachineResourceMonthCell {
  resourceCd: string;
  month: string;
  requiredMinutes: number;
}

export interface ProductionScheduleLoadBalancingMachinePartRowDetail {
  rowId: string;
  fseiban: string;
  productNo: string;
  fhincd: string;
  fhinmei: string;
  fkojun: string | null;
  resourceCd: string;
  requiredMinutes: number;
  effectiveDueDate: string;
  effectiveDueDateSource: 'manual' | 'csv';
}

export interface ProductionScheduleLoadBalancingMachineMonthlyLoadResponse {
  siteKey: string;
  fromMonth: string;
  toMonth: string;
  months: string[];
  machines: ProductionScheduleLoadBalancingMachineSummary[];
  selectedMachineName: string | null;
  selectedFhincd: string | null;
  parts: ProductionScheduleLoadBalancingMachinePartSummary[];
  resourceMonths: ProductionScheduleLoadBalancingMachineResourceMonthCell[];
  partRows: ProductionScheduleLoadBalancingMachinePartRowDetail[];
}

export type ProductionScheduleLoadBalancingStartDateLevelingUnallocatedReason =
  | 'missing_planned_start_date'
  | 'missing_effective_due_date'
  | 'no_active_days'
  | 'zero_required_minutes';

export interface ProductionScheduleLoadBalancingStartDateLevelingResource {
  resourceCd: string;
  workCalendarMode: ProductionScheduleLoadBalancingWorkCalendarMode;
  requiredMinutes: number;
  availableMinutes: number | null;
  overMinutes: number;
}

export interface ProductionScheduleLoadBalancingStartDateLevelingCell {
  resourceCd: string;
  bucketKey: string;
  requiredMinutes: number;
  availableMinutes: number | null;
  overMinutes: number;
}

export interface ProductionScheduleLoadBalancingStartDateLevelingAllocatedRow {
  rowId: string;
  fseiban: string;
  productNo: string;
  fhincd: string;
  fkojun: string | null;
  resourceCd: string;
  totalMinutes: number;
  plannedStartDate: string;
  effectiveDueDate: string;
  workCalendarMode: ProductionScheduleLoadBalancingWorkCalendarMode;
}

export interface ProductionScheduleLoadBalancingStartDateLevelingUnallocatedRow {
  rowId: string;
  fseiban: string;
  productNo: string;
  fhincd: string;
  fkojun: string | null;
  resourceCd: string;
  reason: ProductionScheduleLoadBalancingStartDateLevelingUnallocatedReason;
  requiredMinutes: number;
}

export interface ProductionScheduleLoadBalancingStartDateLevelingSimulatedMove {
  rowId: string;
  targetDate: string;
  resourceCd: string;
  movedMinutes: number;
  fromDateKeys: string[];
}

export interface ProductionScheduleLoadBalancingStartDateLevelingResponse {
  siteKey: string;
  fromMonth: string;
  toMonth: string;
  bucket: 'month' | 'day';
  focusMonth: string | null;
  months: string[];
  days: string[];
  resources: ProductionScheduleLoadBalancingStartDateLevelingResource[];
  cells: ProductionScheduleLoadBalancingStartDateLevelingCell[];
  allocatedRows: ProductionScheduleLoadBalancingStartDateLevelingAllocatedRow[];
  unallocatedRows: ProductionScheduleLoadBalancingStartDateLevelingUnallocatedRow[];
  calendarSettings: ProductionScheduleLoadBalancingWorkCalendarItem[];
  simulatedMoves: ProductionScheduleLoadBalancingStartDateLevelingSimulatedMove[];
}

export interface ProductionScheduleDueManagementSummaryItem {
  fseiban: string;
  machineName: string | null;
  dueDate: string | null;
  partsCount: number;
  processCount: number;
  totalRequiredMinutes: number;
  actualEstimatedMinutes: number;
  actualCoverageRatio: number;
}

export interface ProductionScheduleDueManagementTriageReason {
  code:
    | 'DUE_DATE_MISSING'
    | 'DUE_DATE_OVERDUE'
    | 'DUE_DATE_TODAY'
    | 'DUE_DATE_TOMORROW'
    | 'DUE_DATE_SOON'
    | 'LARGE_PART_COUNT'
    | 'LARGE_PROCESS_COUNT'
    | 'SURFACE_PRIORITY';
  message: string;
}

export interface ProductionScheduleDueManagementTriageItem extends ProductionScheduleDueManagementSummaryItem {
  zone: 'danger' | 'caution' | 'safe';
  daysUntilDue: number | null;
  reasons: ProductionScheduleDueManagementTriageReason[];
  isSelected: boolean;
  topProcessingType: string | null;
}

export interface ProductionScheduleDueManagementTriageResult {
  zones: {
    danger: ProductionScheduleDueManagementTriageItem[];
    caution: ProductionScheduleDueManagementTriageItem[];
    safe: ProductionScheduleDueManagementTriageItem[];
  };
  selectedFseibans: string[];
}

export interface ProductionScheduleDueManagementDailyPlanResult {
  planDate: string;
  status: string;
  confirmedAt: string | null;
  updatedAt: string | null;
  items: Array<{
    fseiban: string;
    isInTodayTriage: boolean;
    isCarryover: boolean;
  }>;
  orderedFseibans: string[];
}

export interface ProductionScheduleDueManagementGlobalRankResult {
  orderedFseibans: string[];
}

/** manual-order-overview: 資源内の1行（上ペイン行明細用。順位差分は含めない） */
export interface ProductionScheduleDueManagementManualOrderOverviewRow {
  orderNumber: number;
  fseiban: string;
  fhincd: string;
  /** 工順（FKOJUN）表示用。処理種別とは別。 */
  processOrderLabel: string;
  /** @deprecated 後方互換。`processOrderLabel` を使用。 */
  processLabel: string;
  machineName: string;
  partName: string;
}

export interface ProductionScheduleDueManagementManualOrderOverviewResource {
  resourceCd: string;
  assignedCount: number;
  maxOrderNumber: number | null;
  avgGlobalRankGap: number | null;
  comparedCount: number;
  missingGlobalRankCount: number;
  lastUpdatedAt: string | null;
  lastUpdatedBy: string | null;
  rows: ProductionScheduleDueManagementManualOrderOverviewRow[];
}

/** API manual-order-overview v2: 旧サイト単位行のみを絞り込むときの deviceScopeKey */
export const MANUAL_ORDER_LEGACY_SITE_BUCKET_KEY = '__legacy_site__';

export interface ProductionScheduleDueManagementManualOrderOverviewDeviceSlice {
  deviceScopeKey: string;
  label: string;
  resources: ProductionScheduleDueManagementManualOrderOverviewResource[];
}

export interface ProductionScheduleDueManagementManualOrderOverviewResultV1 {
  actorLocation: string;
  targetLocation: string;
  resources: ProductionScheduleDueManagementManualOrderOverviewResource[];
}

export interface ProductionScheduleDueManagementManualOrderOverviewResultV2 {
  actorLocation: string;
  siteKey: string;
  deviceScopeKey: string | null;
  registeredDeviceScopeKeys: string[];
  devices: ProductionScheduleDueManagementManualOrderOverviewDeviceSlice[];
}

export type ProductionScheduleDueManagementManualOrderOverviewResult =
  | ProductionScheduleDueManagementManualOrderOverviewResultV1
  | ProductionScheduleDueManagementManualOrderOverviewResultV2;

export interface ProductionScheduleDueManagementGlobalRankScoreBreakdown {
  resourceDemandScore: number;
  dueUrgencyScore: number;
  carryoverScore: number;
  partPriorityScore: number;
  historyCalibrationScore: number;
  actualHoursScore: number;
  weightedTotalScore: number;
  reasons: string[];
}

export interface ProductionScheduleDueManagementGlobalRankProposalItem {
  fseiban: string;
  rank: number;
  score: number;
  estimatedActualMinutes: number;
  coverageRatio: number;
  breakdown: ProductionScheduleDueManagementGlobalRankScoreBreakdown;
}

export interface ProductionScheduleDueManagementGlobalRankProposal {
  generatedAt: string;
  locationKey: string;
  candidateCount: number;
  orderedFseibans: string[];
  items: ProductionScheduleDueManagementGlobalRankProposalItem[];
}

export interface ProductionScheduleDueManagementGlobalRankAutoGenerateResult {
  success: boolean;
  applied: boolean;
  orderedFseibans: string[];
  previousOrderedFseibans: string[];
  sourceType: 'auto';
  guard: {
    rejected: boolean;
    reason: string | null;
    reorderDeltaRatio: number;
  };
  proposal: ProductionScheduleDueManagementGlobalRankProposal;
}

export interface DueManagementTargetContext {
  targetLocation?: string;
  rankingScope?: 'globalShared' | 'locationScoped' | 'localTemporary';
}

export interface DueManagementResourceFilterContext {
  resourceCd?: string;
  resourceCategory?: 'grinding' | 'cutting';
}

export interface ProductionScheduleDueManagementPartProcessItem {
  rowId: string;
  resourceCd: string;
  resourceNames?: string[];
  processOrder: number | null;
  isCompleted: boolean;
}

export type ProductionScheduleDueManagementEffectiveDueSource = 'manual' | 'csv' | null;

export interface ProductionScheduleDueManagementPartItem {
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
  processes: ProductionScheduleDueManagementPartProcessItem[];
  currentPriorityRank: number | null;
  suggestedPriorityRank: number;
  /** Aggregated from order supplement CSV */
  plannedQuantity?: number | null;
  plannedStartDate?: string | null;
  plannedEndDate?: string | null;
  effectiveDueDate?: string | null;
  effectiveDueDateSource?: ProductionScheduleDueManagementEffectiveDueSource;
}

export interface ProductionScheduleDueManagementProcessingTypeDueDateItem {
  processingType: string;
  dueDate: string | null;
}

export interface ProductionScheduleDueManagementSeibanDetail {
  fseiban: string;
  machineName: string | null;
  dueDate: string | null;
  processingTypeDueDates?: ProductionScheduleDueManagementProcessingTypeDueDateItem[];
  parts: ProductionScheduleDueManagementPartItem[];
}

export interface ProductionScheduleProgressOverviewProcessItem {
  /** `{@link ProductionScheduleRow.id}`（CSV ダッシュボード行）と同一。 */
  rowId: string;
  resourceCd: string;
  resourceNames?: string[];
  processOrder: number | null;
  isCompleted: boolean;
}

export interface ProductionScheduleProgressOverviewPartItem {
  productNo: string;
  fhincd: string;
  fhinmei: string;
  dueDate: string | null;
  processes: ProductionScheduleProgressOverviewProcessItem[];
}

export interface ProductionScheduleProgressOverviewSeibanItem {
  fseiban: string;
  /** `ProductionScheduleRow.seibanJoinKey` と突合する専用キー。現状は製番文字列と同値。 */
  seibanJoinKey: string;
  machineName: string | null;
  dueDate: string | null;
  parts: ProductionScheduleProgressOverviewPartItem[];
}

export interface ProductionScheduleProgressOverviewResult {
  updatedAt: string | null;
  registeredFseibans: string[];
  scheduled: ProductionScheduleProgressOverviewSeibanItem[];
  unscheduled: ProductionScheduleProgressOverviewSeibanItem[];
}

export async function getKioskProductionSchedule(params?: {
  productNo?: string;
  q?: string;
  productNos?: string;
  resourceCds?: string;
  resourceAssignedOnlyCds?: string;
  resourceCategory?: 'grinding' | 'cutting';
  machineName?: string;
  hasNoteOnly?: boolean;
  hasDueDateOnly?: boolean;
  page?: number;
  pageSize?: number;
  allowResourceOnly?: boolean;
  /** v2: Mac が参照する端末の deviceScopeKey */
  targetDeviceScopeKey?: string;
  /** `leaderboard`: API が軽量プロファイルで応答（actual-hours は省略、機種名は付与） */
  responseProfile?: 'full' | 'leaderboard';
  /** 自主検査キオスク一覧: 開始可能行のみ（サーバー側フィルタ・ページング） */
  selfInspectionEligibleOnly?: boolean;
}) {
  const { data } = await api.get<ProductionScheduleListResponse>('/kiosk/production-schedule', { params });
  return data;
}

export async function getKioskProductionScheduleLeaderboardShell(
  params?: KioskProductionScheduleLeaderboardPhasedQueryParams
) {
  const { data } = await api.get<ProductionScheduleLeaderboardShellResponse>(
    '/kiosk/production-schedule/leaderboard-shell',
    { params }
  );
  return data;
}

export type KioskProductionScheduleLeaderboardShellContinuePayload = KioskProductionScheduleLeaderboardPhasedQueryParams & {
  /** 後方互換: snapshot が無い、または古いクライアントのみ */
  excludeRowIds?: string[];
  snapshotId?: string;
  cursor?: number;
};

export async function postKioskProductionScheduleLeaderboardShellContinue(
  payload: KioskProductionScheduleLeaderboardShellContinuePayload
) {
  const { data } = await api.post<ProductionScheduleLeaderboardShellResponse>(
    '/kiosk/production-schedule/leaderboard-shell/continue',
    payload
  );
  return data;
}

export async function getKioskProductionScheduleLeaderboardTotal(params?: KioskProductionScheduleLeaderboardPhasedQueryParams) {
  const { data } = await api.get<ProductionScheduleLeaderboardTotalResponse>(
    '/kiosk/production-schedule/leaderboard-total',
    { params }
  );
  return data;
}

export async function postKioskProductionScheduleLeaderboardDecorations(payload: {
  rowIds: string[];
  targetDeviceScopeKey?: string;
}) {
  const { data } = await api.post<ProductionScheduleLeaderboardDecorationsResponse>(
    '/kiosk/production-schedule/leaderboard-decorations',
    payload
  );
  return data;
}

export type ProductionScheduleLeaderboardLaborMetadataEntry = {
  id: string;
  machineRequiredMinutes: number;
  laborRequiredMinutes: number;
};

export type ProductionScheduleLeaderboardLaborMetadataResponse = {
  rowMetadata: ProductionScheduleLeaderboardLaborMetadataEntry[];
};

export async function postKioskProductionScheduleLeaderboardLaborMetadata(payload: {
  rowIds: string[];
  targetDeviceScopeKey?: string;
}) {
  const { data } = await api.post<ProductionScheduleLeaderboardLaborMetadataResponse>(
    '/kiosk/production-schedule/leaderboard-board/labor-metadata',
    payload
  );
  return data;
}

/** 順位ボード集約 GET: `boardResourceCds` にスロット順の資源（カンマ区切り） */
export type KioskProductionScheduleLeaderboardBoardQueryParams = KioskProductionScheduleLeaderboardPhasedQueryParams & {
  boardResourceCds: string;
  /** 省略時 true。キオスク順位ボードは false で装飾を `leaderboard-decorations` 後取り */
  includeDecorations?: boolean;
  /** 省略時 false。`+人` OFF の初期表示は false で人工数 lookup を後回しにする */
  includeLabor?: boolean;
  /** true のとき初回 shell は exact total を待たず、continue で正確な total に戻す */
  deferTotals?: boolean;
  deferResidualSummary?: boolean;
};

export type LeaderboardBoardResourceSliceResponse = {
  resourceCd: string;
  snapshotId?: string;
  nextCursor?: number;
  hasMore: boolean;
  total: number;
  pageSize: number;
};

export type ProductionScheduleLeaderboardBoardResponse = ProductionScheduleListResponse & {
  total: number;
  totalsDeferred?: boolean;
  snapshotExpired?: boolean;
  /** 続きチャンクのみ（スロット順連結）。古いサーバまたは安全フォールバック時は未定義 */
  deltaRows?: ProductionScheduleRow[];
  resources: LeaderboardBoardResourceSliceResponse[];
  /** 工程変更残骸疑いの総件数（通常 rows には含めない） */
  processChangeResidualTotal?: number;
  processChangeResidualRows?: ProductionScheduleRow[];
  processChangeResidualRepresentativeLimit?: number;
  residualSummaryDeferred?: true;
};

export async function getKioskProductionScheduleLeaderboardBoard(
  params: KioskProductionScheduleLeaderboardBoardQueryParams
) {
  const { data } = await api.get<ProductionScheduleLeaderboardBoardResponse>(
    '/kiosk/production-schedule/leaderboard-board',
    { params }
  );
  return data;
}

export type KioskProductionScheduleLeaderboardBoardContinuePayload = Omit<
  KioskProductionScheduleLeaderboardBoardQueryParams,
  'page' | 'pageSize' | 'deferTotals'
> & {
  boardResourceCds: string;
  resourceSlices: Array<{
    resourceCd: string;
    snapshotId?: string;
    cursor?: number;
    excludeRowIds?: string[];
    hasMore: boolean;
  }>;
  pageSize?: number;
  includeResidualSummary?: boolean;
};

export async function postKioskProductionScheduleLeaderboardBoardContinue(
  payload: KioskProductionScheduleLeaderboardBoardContinuePayload
) {
  const { data } = await api.post<ProductionScheduleLeaderboardBoardResponse>(
    '/kiosk/production-schedule/leaderboard-board/continue',
    payload
  );
  return data;
}

export type KioskProductionScheduleLeaderboardClientPerfPayload = {
  sessionId: string;
  event: string;
  pagePath?: string;
  paramsKeyHash?: string;
  resourceCds?: string;
  markMs?: number;
  elapsedMs?: number;
  detail?: Record<string, string | number | boolean | null>;
};

export async function postKioskProductionScheduleLeaderboardClientPerf(
  payload: KioskProductionScheduleLeaderboardClientPerfPayload
) {
  await api.post('/kiosk/production-schedule/leaderboard-board/client-perf', payload);
}


export interface KioskProductionScheduleOrderSearchResponse {
  partNameOptions: string[];
  orders: string[];
}

export type KioskProductionScheduleCompletionIntent = 'complete' | 'incomplete';

/**
 * キオスク生産日程: 完了状態を明示設定する（非トグル）。
 * 順位ボード・一覧の主経路。
 */
export async function setKioskProductionScheduleRowCompletion(
  rowId: string,
  intent: KioskProductionScheduleCompletionIntent
) {
  const { data } = await api.put<{
    success: boolean;
    unchanged?: boolean;
    alreadyCompleted: boolean;
    rowData: Record<string, unknown>;
    debug?: {
      totalMs: number;
      findRowMs: number;
      findAssignmentMs: number;
      txMs: number;
      txUpdateRowMs: number;
      txDeleteAssignmentMs: number | null;
      txShiftAssignmentsMs: number | null;
      txShiftAssignmentsCount: number | null;
      hadAssignment: boolean;
    };
  }>(`/kiosk/production-schedule/${rowId}/completion`, { intent });
  return data;
}

/** @deprecated トグル互換 API。新規は {@link setKioskProductionScheduleRowCompletion} を使用 */
export async function completeKioskProductionScheduleRow(rowId: string) {
  const { data } = await api.put<{
    success: boolean;
    alreadyCompleted: boolean;
    unchanged?: boolean;
    rowData: Record<string, unknown>;
    debug?: {
      totalMs: number;
      findRowMs: number;
      findAssignmentMs: number;
      txMs: number;
      txUpdateRowMs: number;
      txDeleteAssignmentMs: number | null;
      txShiftAssignmentsMs: number | null;
      txShiftAssignmentsCount: number | null;
      hadAssignment: boolean;
    };
  }>(`/kiosk/production-schedule/${rowId}/complete`, {});
  return data;
}

export async function getKioskProductionScheduleResources() {
  const { data } = await api.get<{
    resources: string[];
    resourceItems?: Array<{ resourceCd: string; excluded: boolean }>;
    resourceNameMap?: Record<string, string[]>;
  }>(
    '/kiosk/production-schedule/resources'
  );
  return {
    resources: data.resources,
    resourceItems: data.resourceItems ?? data.resources.map((resourceCd) => ({ resourceCd, excluded: false })),
    resourceNameMap: data.resourceNameMap ?? {}
  };
}

export async function getKioskProductionScheduleDueManagementSummary(context?: DueManagementResourceFilterContext) {
  const { data } = await api.get<{ summaries: ProductionScheduleDueManagementSummaryItem[] }>(
    '/kiosk/production-schedule/due-management/summary',
    { params: context }
  );
  return data.summaries;
}

export async function getKioskProductionScheduleDueManagementTriage(context?: DueManagementResourceFilterContext) {
  const { data } = await api.get<ProductionScheduleDueManagementTriageResult>(
    '/kiosk/production-schedule/due-management/triage',
    { params: context }
  );
  return data;
}

export async function getKioskProductionScheduleDueManagementDailyPlan(context?: DueManagementResourceFilterContext) {
  const { data } = await api.get<ProductionScheduleDueManagementDailyPlanResult>(
    '/kiosk/production-schedule/due-management/daily-plan',
    { params: context }
  );
  return data;
}

export async function updateKioskProductionScheduleDueManagementDailyPlan(payload: {
  orderedFseibans: string[];
}) {
  const { data } = await api.put<
    { success: boolean } & ProductionScheduleDueManagementDailyPlanResult
  >('/kiosk/production-schedule/due-management/daily-plan', payload);
  return data;
}

export async function getKioskProductionScheduleDueManagementGlobalRank(
  context?: DueManagementTargetContext & DueManagementResourceFilterContext
) {
  const { data } = await api.get<ProductionScheduleDueManagementGlobalRankResult>(
    '/kiosk/production-schedule/due-management/global-rank',
    { params: context }
  );
  return data;
}

export async function getKioskProductionScheduleDueManagementManualOrderOverview(
  context?: DueManagementTargetContext &
    DueManagementResourceFilterContext & {
      siteKey?: string;
      deviceScopeKey?: string;
    }
) {
  const params: Record<string, string | undefined> = {};
  if (context?.siteKey) {
    params.siteKey = context.siteKey;
    if (context.deviceScopeKey) {
      params.deviceScopeKey = context.deviceScopeKey;
    }
  } else if (context?.targetLocation) {
    params.targetLocation = context.targetLocation;
  }
  if (context?.rankingScope) params.rankingScope = context.rankingScope;
  if (context?.resourceCd) params.resourceCd = context.resourceCd;
  if (context?.resourceCategory) params.resourceCategory = context.resourceCategory;

  const { data } = await api.get<ProductionScheduleDueManagementManualOrderOverviewResult>(
    '/kiosk/production-schedule/due-management/manual-order-overview',
    { params }
  );
  return data;
}

export async function getKioskProductionScheduleManualOrderSiteDevices(siteKey: string) {
  const { data } = await api.get<{ siteKey: string; deviceScopeKeys: string[] }>(
    '/kiosk/production-schedule/manual-order/site-devices',
    { params: { siteKey } }
  );
  return data;
}

export interface ManualOrderResourceAssignmentDevice {
  deviceScopeKey: string;
  resourceCds: string[];
}

export async function getKioskProductionScheduleManualOrderResourceAssignments(siteKey: string) {
  const { data } = await api.get<{
    siteKey: string;
    assignments: ManualOrderResourceAssignmentDevice[];
  }>('/kiosk/production-schedule/manual-order-resource-assignments', { params: { siteKey } });
  return data;
}

export async function putKioskProductionScheduleManualOrderResourceAssignments(payload: {
  siteKey: string;
  deviceScopeKey: string;
  resourceCds: string[];
}) {
  const { data } = await api.put<{
    siteKey: string;
    deviceScopeKey: string;
    resourceCds: string[];
  }>('/kiosk/production-schedule/manual-order-resource-assignments', payload);
  return data;
}

export async function updateKioskProductionScheduleDueManagementGlobalRank(payload: {
  orderedFseibans: string[];
  targetLocation?: string;
  rankingScope?: 'globalShared' | 'locationScoped' | 'localTemporary';
}) {
  const { data } = await api.put<
    { success: boolean } & ProductionScheduleDueManagementGlobalRankResult
  >('/kiosk/production-schedule/due-management/global-rank', payload);
  return data;
}

export async function getKioskProductionScheduleDueManagementGlobalRankProposal(
  context?: DueManagementTargetContext & DueManagementResourceFilterContext
) {
  const { data } = await api.get<ProductionScheduleDueManagementGlobalRankProposal>(
    '/kiosk/production-schedule/due-management/global-rank/proposal',
    { params: context }
  );
  return data;
}

export async function autoGenerateKioskProductionScheduleDueManagementGlobalRank(payload?: {
  minCandidateCount?: number;
  maxReorderDeltaRatio?: number;
  keepExistingTail?: boolean;
  targetLocation?: string;
  rankingScope?: 'globalShared' | 'locationScoped' | 'localTemporary';
}) {
  const { data } = await api.put<ProductionScheduleDueManagementGlobalRankAutoGenerateResult>(
    '/kiosk/production-schedule/due-management/global-rank/auto-generate',
    payload ?? {}
  );
  return data;
}

export async function getKioskProductionScheduleDueManagementGlobalRankExplanation(fseiban: string) {
  const { data } = await api.get<{
    fseiban: string;
    found: boolean;
    item: ProductionScheduleDueManagementGlobalRankProposalItem | null;
  }>(`/kiosk/production-schedule/due-management/global-rank/explanation/${encodeURIComponent(fseiban)}`);
  return data;
}

export async function getKioskProductionScheduleProcessingTypeOptions() {
  const { data } = await api.get<{ options: ProductionScheduleProcessingTypeOption[] }>(
    '/kiosk/production-schedule/processing-type-options'
  );
  return data.options;
}

export async function getKioskProductionScheduleDueManagementSeibanDetail(
  fseiban: string,
  context?: DueManagementResourceFilterContext
) {
  const { data } = await api.get<{ detail: ProductionScheduleDueManagementSeibanDetail }>(
    `/kiosk/production-schedule/due-management/seiban/${encodeURIComponent(fseiban)}`,
    { params: context }
  );
  return data.detail;
}

export async function getKioskProductionScheduleProgressOverview() {
  const { data } = await api.get<{ overview: ProductionScheduleProgressOverviewResult }>(
    '/kiosk/production-schedule/progress-overview'
  );
  return data.overview;
}

export async function updateKioskProductionScheduleDueManagementSeibanDueDate(
  fseiban: string,
  payload: { dueDate: string }
) {
  const { data } = await api.put<{ success: boolean; dueDate: string | null; affectedRows: number }>(
    `/kiosk/production-schedule/due-management/seiban/${encodeURIComponent(fseiban)}/due-date`,
    payload
  );
  return data;
}

export async function updateKioskProductionScheduleDueManagementSeibanProcessingDueDate(
  fseiban: string,
  processingType: string,
  payload: { dueDate: string }
) {
  const { data } = await api.put<{ success: boolean; processingType: string; dueDate: string | null; affectedRows: number }>(
    `/kiosk/production-schedule/due-management/seiban/${encodeURIComponent(
      fseiban
    )}/processing/${encodeURIComponent(processingType)}/due-date`,
    payload
  );
  return data;
}

export async function updateKioskProductionScheduleDueManagementPartPriorities(
  fseiban: string,
  payload: { orderedFhincds: string[] }
) {
  const { data } = await api.put<{
    success: boolean;
    priorities: Array<{ fhincd: string; priorityRank: number }>;
  }>(`/kiosk/production-schedule/due-management/seiban/${encodeURIComponent(fseiban)}/part-priorities`, payload);
  return data;
}

export async function updateKioskProductionScheduleDueManagementPartProcessingType(
  fseiban: string,
  fhincd: string,
  payload: { processingType: string }
) {
  const { data } = await api.put<{ success: boolean; fhincd: string; processingType: string | null }>(
    `/kiosk/production-schedule/due-management/seiban/${encodeURIComponent(fseiban)}/parts/${encodeURIComponent(
      fhincd
    )}/processing`,
    payload
  );
  return data;
}

export async function updateKioskProductionScheduleDueManagementPartNote(
  fseiban: string,
  fhincd: string,
  payload: { note: string }
) {
  const { data } = await api.put<{ success: boolean; fseiban: string; fhincd: string; note: string | null }>(
    `/kiosk/production-schedule/due-management/seiban/${encodeURIComponent(fseiban)}/parts/${encodeURIComponent(
      fhincd
    )}/note`,
    payload
  );
  return data;
}

export async function updateKioskProductionScheduleDueManagementTriageSelection(payload: {
  selectedFseibans: string[];
}) {
  const { data } = await api.put<{ success: boolean; selectedFseibans: string[] }>(
    '/kiosk/production-schedule/due-management/triage/selection',
    payload
  );
  return data;
}

export async function getProductionScheduleResourceCategorySettings(location: string) {
  const { data } = await api.get<{
    settings: ProductionScheduleResourceCategorySettings;
    locations: string[];
  }>('/production-schedule-settings/resource-categories', {
    params: { location }
  });
  return data;
}

export async function getProductionScheduleProcessingTypeOptions(location: string) {
  const { data } = await api.get<{
    settings: {
      location: string;
      options: ProductionScheduleProcessingTypeOption[];
    };
    locations: string[];
  }>('/production-schedule-settings/processing-type-options', {
    params: { location }
  });
  return data;
}

export async function getProductionScheduleResourceCodeMappings(location: string) {
  const { data } = await api.get<{
    settings: {
      location: string;
      mappings: ProductionScheduleResourceCodeMapping[];
    };
    locations: string[];
  }>('/production-schedule-settings/resource-code-mappings', {
    params: { location }
  });
  return data;
}

export async function updateProductionScheduleResourceCodeMappings(payload: {
  location: string;
  mappings: ProductionScheduleResourceCodeMapping[];
}) {
  const { data } = await api.put<{
    settings: {
      location: string;
      mappings: ProductionScheduleResourceCodeMapping[];
    };
  }>('/production-schedule-settings/resource-code-mappings', payload);
  return data.settings;
}

export async function importProductionScheduleResourceCodeMappingsFromCsv(payload: {
  location: string;
  csvText: string;
  dryRun: boolean;
}) {
  const { data } = await api.post<{
    result: ProductionScheduleResourceCodeMappingsImportResult;
  }>('/production-schedule-settings/resource-code-mappings/import-csv', payload);
  return data.result;
}

export async function updateProductionScheduleProcessingTypeOptions(payload: {
  location: string;
  options: ProductionScheduleProcessingTypeOption[];
}) {
  const { data } = await api.put<{
    settings: {
      location: string;
      options: ProductionScheduleProcessingTypeOption[];
    };
  }>('/production-schedule-settings/processing-type-options', payload);
  return data.settings;
}

export async function updateProductionScheduleResourceCategorySettings(payload: {
  location: string;
  cuttingExcludedResourceCds: string[];
}) {
  const { data } = await api.put<{ settings: ProductionScheduleResourceCategorySettings }>(
    '/production-schedule-settings/resource-categories',
    payload
  );
  return data.settings;
}

export async function getProductionScheduleDueManagementAccessPasswordSettings(location: string) {
  const { data } = await api.get<{
    settings: ProductionScheduleDueManagementAccessPasswordSettings;
  }>('/production-schedule-settings/due-management-access-password', {
    params: { location }
  });
  return data.settings;
}

export async function updateProductionScheduleDueManagementAccessPassword(payload: {
  location: string;
  password: string;
}) {
  const { data } = await api.put<{
    settings: ProductionScheduleDueManagementAccessPasswordSettings;
  }>('/production-schedule-settings/due-management-access-password', payload);
  return data.settings;
}

export async function getProductionScheduleOrderSplitPilotSettings() {
  const { data } = await api.get<{
    settings: ProductionScheduleOrderSplitPilotSettings;
  }>('/production-schedule-settings/order-split-pilot');
  return data.settings;
}

export async function updateProductionScheduleOrderSplitPilotSettings(payload: {
  enabled: boolean;
}) {
  const { data } = await api.put<{
    settings: ProductionScheduleOrderSplitPilotSettings;
  }>('/production-schedule-settings/order-split-pilot', payload);
  return data.settings;
}

export async function getKioskProductionScheduleOrderSplitStatus() {
  const { data } = await api.get<{
    settings: ProductionScheduleOrderSplitPilotSettings;
  }>('/kiosk/production-schedule/order-split/status');
  return data.settings;
}

export async function getProductionScheduleLoadBalancingCapacityBase(location: string) {
  const { data } = await api.get<{
    settings: { siteKey: string; items: ProductionScheduleLoadBalancingCapacityBaseItem[] };
  }>('/production-schedule-settings/load-balancing/capacity-base', {
    params: { location }
  });
  return data.settings;
}

export async function updateProductionScheduleLoadBalancingCapacityBase(payload: {
  location: string;
  items: ProductionScheduleLoadBalancingCapacityBaseItem[];
}) {
  const { data } = await api.put<{
    settings: { siteKey: string; items: ProductionScheduleLoadBalancingCapacityBaseItem[] };
  }>('/production-schedule-settings/load-balancing/capacity-base', payload);
  return data.settings;
}

export async function getProductionScheduleLoadBalancingMonthlyCapacity(location: string, yearMonth: string) {
  const { data } = await api.get<{
    settings: { siteKey: string; yearMonth: string; items: ProductionScheduleLoadBalancingMonthlyCapacityItem[] };
  }>('/production-schedule-settings/load-balancing/monthly-capacity', {
    params: { location, yearMonth }
  });
  return data.settings;
}

export async function updateProductionScheduleLoadBalancingMonthlyCapacity(payload: {
  location: string;
  yearMonth: string;
  items: ProductionScheduleLoadBalancingMonthlyCapacityItem[];
}) {
  const { data } = await api.put<{
    settings: { siteKey: string; yearMonth: string; items: ProductionScheduleLoadBalancingMonthlyCapacityItem[] };
  }>('/production-schedule-settings/load-balancing/monthly-capacity', payload);
  return data.settings;
}

export async function getProductionScheduleLoadBalancingClasses(location: string) {
  const { data } = await api.get<{
    settings: { siteKey: string; items: ProductionScheduleLoadBalancingClassItem[] };
  }>('/production-schedule-settings/load-balancing/classes', {
    params: { location }
  });
  return data.settings;
}

export async function updateProductionScheduleLoadBalancingClasses(payload: {
  location: string;
  items: ProductionScheduleLoadBalancingClassItem[];
}) {
  const { data } = await api.put<{
    settings: { siteKey: string; items: ProductionScheduleLoadBalancingClassItem[] };
  }>('/production-schedule-settings/load-balancing/classes', payload);
  return data.settings;
}

export async function getProductionScheduleLoadBalancingTransferRules(location: string) {
  const { data } = await api.get<{
    settings: { siteKey: string; items: ProductionScheduleLoadBalancingTransferRuleItem[] };
  }>('/production-schedule-settings/load-balancing/transfer-rules', {
    params: { location }
  });
  return data.settings;
}

export async function updateProductionScheduleLoadBalancingTransferRules(payload: {
  location: string;
  items: ProductionScheduleLoadBalancingTransferRuleItem[];
}) {
  const { data } = await api.put<{
    settings: { siteKey: string; items: ProductionScheduleLoadBalancingTransferRuleItem[] };
  }>('/production-schedule-settings/load-balancing/transfer-rules', payload);
  return data.settings;
}

export async function getProductionScheduleLoadBalancingWorkCalendars(location: string) {
  const { data } = await api.get<{
    settings: { siteKey: string; items: ProductionScheduleLoadBalancingWorkCalendarItem[] };
  }>('/production-schedule-settings/load-balancing/work-calendars', {
    params: { location }
  });
  return data.settings;
}

export async function updateProductionScheduleLoadBalancingWorkCalendars(payload: {
  location: string;
  items: ProductionScheduleLoadBalancingWorkCalendarItem[];
}) {
  const { data } = await api.put<{
    settings: { siteKey: string; items: ProductionScheduleLoadBalancingWorkCalendarItem[] };
  }>('/production-schedule-settings/load-balancing/work-calendars', payload);
  return data.settings;
}

export async function getKioskProductionScheduleLoadBalancingOverview(params: {
  month: string;
  targetDeviceScopeKey?: string;
}) {
  const { data } = await api.get<{
    siteKey: string;
    yearMonth: string;
    resources: ProductionScheduleLoadBalancingOverviewResource[];
  }>('/kiosk/production-schedule/load-balancing/overview', { params });
  return data;
}

export async function postKioskProductionScheduleLoadBalancingSuggestions(payload: {
  month: string;
  targetDeviceScopeKey?: string;
  maxSuggestions?: number;
  overResourceCds?: string[];
}) {
  const { data } = await api.post<{
    siteKey: string;
    yearMonth: string;
    suggestions: ProductionScheduleLoadBalancingSuggestionItem[];
  }>('/kiosk/production-schedule/load-balancing/suggestions', payload);
  return data;
}

export async function postKioskProductionScheduleLoadBalancingOutsourcingCandidates(payload: {
  month: string;
  targetDeviceScopeKey?: string;
  overResourceCds?: string[];
  maxCandidates?: number;
}) {
  const { data } = await api.post<ProductionScheduleLoadBalancingOutsourcingCandidatesResponse>(
    '/kiosk/production-schedule/load-balancing/outsourcing-candidates',
    payload
  );
  return data;
}

export async function postKioskProductionScheduleLoadBalancingOutsourcingSimulate(payload: {
  month: string;
  targetDeviceScopeKey?: string;
  overResourceCds?: string[];
  selectedRowIds?: string[];
  selectedCandidateIds?: string[];
}) {
  const { data } = await api.post<ProductionScheduleLoadBalancingOutsourcingSimulateResponse>(
    '/kiosk/production-schedule/load-balancing/outsourcing-simulate',
    payload
  );
  return data;
}

export async function postKioskProductionScheduleLoadBalancingOutsourcingPlan(payload: {
  month: string;
  targetDeviceScopeKey?: string;
  overResourceCds?: string[];
  strategy?: 'max_over_reduction';
}) {
  const { data } = await api.post<ProductionScheduleLoadBalancingOutsourcingPlanResponse>(
    '/kiosk/production-schedule/load-balancing/outsourcing-plan',
    payload
  );
  return data;
}

export async function postKioskProductionScheduleLoadBalancingOutsourcingReplacements(payload: {
  month: string;
  targetDeviceScopeKey?: string;
  overResourceCds?: string[];
  currentSelectedCandidateIds: string[];
  removeCandidateId: string;
  maxOptions?: number;
}) {
  const { data } = await api.post<ProductionScheduleLoadBalancingOutsourcingReplacementsResponse>(
    '/kiosk/production-schedule/load-balancing/outsourcing-replacements',
    payload
  );
  return data;
}

export async function getKioskProductionScheduleLoadBalancingMachineMonthlyLoad(params: {
  fromMonth: string;
  toMonth: string;
  targetDeviceScopeKey?: string;
  machineName?: string;
  fhincd?: string;
}) {
  const { data } = await api.get<ProductionScheduleLoadBalancingMachineMonthlyLoadResponse>(
    '/kiosk/production-schedule/load-balancing/machine-monthly-load',
    { params }
  );
  return data;
}

export async function getKioskProductionScheduleLoadBalancingStartDateLeveling(params: {
  fromMonth: string;
  toMonth: string;
  bucket?: 'month' | 'day';
  focusMonth?: string;
  targetDeviceScopeKey?: string;
  resourceCd?: string;
}) {
  const { data } = await api.get<ProductionScheduleLoadBalancingStartDateLevelingResponse>(
    '/kiosk/production-schedule/load-balancing/start-date-leveling',
    { params }
  );
  return data;
}

export async function postKioskProductionScheduleLoadBalancingStartDateLevelingSimulate(payload: {
  fromMonth: string;
  toMonth: string;
  bucket?: 'month' | 'day';
  focusMonth?: string;
  targetDeviceScopeKey?: string;
  resourceCd?: string;
  moves: Array<{ rowId: string; targetDate: string }>;
}) {
  const { data } = await api.post<ProductionScheduleLoadBalancingStartDateLevelingResponse>(
    '/kiosk/production-schedule/load-balancing/start-date-leveling/simulate',
    payload
  );
  return data;
}

export async function verifyKioskDueManagementAccessPassword(payload: { password: string }) {
  const { data } = await api.post<{ success: boolean }>(
    '/kiosk/production-schedule/due-management/verify-access-password',
    payload
  );
  return data;
}

export async function getKioskProductionScheduleOrderUsage(params?: {
  resourceCds?: string;
  targetDeviceScopeKey?: string;
}) {
  const { data } = await api.get<{ usage: Record<string, number[]> }>('/kiosk/production-schedule/order-usage', {
    params
  });
  return data.usage;
}

export async function getKioskProductionScheduleOrderSearchCandidates(params: {
  resourceCds: string;
  resourceCategory?: 'grinding' | 'cutting';
  machineName?: string;
  productNoPrefix: string;
  partName?: string;
}) {
  const { data } = await api.get<KioskProductionScheduleOrderSearchResponse>(
    '/kiosk/production-schedule/order-search',
    { params }
  );
  return data;
}

export async function updateKioskProductionScheduleOrder(
  rowId: string,
  payload: {
    resourceCd: string;
    orderNumber: number | null;
    targetLocation?: string;
    targetDeviceScopeKey?: string;
  }
) {
  const { data } = await api.put<{ success: boolean; orderNumber: number | null }>(
    `/kiosk/production-schedule/${rowId}/order`,
    payload
  );
  return data;
}

export async function updateKioskProductionScheduleNote(rowId: string, payload: { note: string }) {
  const { data } = await api.put<{ success: boolean; note: string | null }>(
    `/kiosk/production-schedule/${rowId}/note`,
    payload
  );
  return data;
}

export async function updateKioskProductionScheduleDueDate(rowId: string, payload: { dueDate: string }) {
  const { data } = await api.put<{ success: boolean; dueDate: string | null }>(
    `/kiosk/production-schedule/${rowId}/due-date`,
    payload
  );
  return data;
}

export type ProductionScheduleOrderSplitItem = {
  id: string;
  displayItemId: string;
  parentCsvDashboardRowId: string;
  splitNo: number;
  splitQuantity: number;
  dueDate: string | null;
  plannedStartDate: string | null;
  plannedEndDate: string | null;
  orderNumber: number | null;
};

export type ProductionScheduleOrderSplitListResponse = {
  parentCsvDashboardRowId: string;
  plannedQuantity: number;
  splits: ProductionScheduleOrderSplitItem[];
  actorLocation?: string;
};

export async function fetchKioskProductionScheduleOrderSplits(
  sourceRowId: string,
  params?: { targetDeviceScopeKey?: string }
) {
  const { data } = await api.get<ProductionScheduleOrderSplitListResponse>(
    `/kiosk/production-schedule/${sourceRowId}/splits`,
    { params }
  );
  return data;
}

export async function replaceKioskProductionScheduleOrderSplits(
  sourceRowId: string,
  payload: {
    resourceCd: string;
    items: Array<{
      id?: string | null;
      splitNo: number;
      splitQuantity: number;
      dueDate?: string | null;
      plannedStartDate?: string | null;
      plannedEndDate?: string | null;
      orderNumber?: number | null;
    }>;
    targetLocation?: string;
    targetDeviceScopeKey?: string;
  }
) {
  const { data } = await api.put<{ success: boolean; splits: ProductionScheduleOrderSplitItem[] }>(
    `/kiosk/production-schedule/${sourceRowId}/splits`,
    payload
  );
  return data;
}

export async function deleteKioskProductionScheduleOrderSplits(
  sourceRowId: string,
  params?: { targetDeviceScopeKey?: string }
) {
  const { data } = await api.delete<{ success: boolean }>(
    `/kiosk/production-schedule/${sourceRowId}/splits`,
    { params }
  );
  return data;
}

export async function updateKioskProductionScheduleSplitOrder(
  splitId: string,
  payload: {
    resourceCd: string;
    orderNumber: number | null;
    targetLocation?: string;
    targetDeviceScopeKey?: string;
  }
) {
  const { data } = await api.put<{ success: boolean; orderNumber: number | null }>(
    `/kiosk/production-schedule/splits/${splitId}/order`,
    payload
  );
  return data;
}

export async function updateKioskProductionScheduleSplitDueDate(splitId: string, payload: { dueDate: string }) {
  const { data } = await api.put<{ success: boolean; dueDate: string | null }>(
    `/kiosk/production-schedule/splits/${splitId}/due-date`,
    payload
  );
  return data;
}

export async function updateKioskProductionScheduleProcessing(
  rowId: string,
  payload: { processingType: string }
) {
  const { data } = await api.put<{ success: boolean; processingType: string | null }>(
    `/kiosk/production-schedule/${rowId}/processing`,
    payload
  );
  return data;
}

export type ProductionScheduleSearchState = {
  inputQuery?: string;
  activeQueries?: string[];
  activeResourceCds?: string[];
  activeResourceAssignedOnlyCds?: string[];
  history?: string[];
};

export type ProductionScheduleSearchHistory = {
  history: string[];
  updatedAt: string | null;
};

export type ProductionScheduleHistoryProgressEntry = {
  total: number;
  completed: number;
  status: 'complete' | 'incomplete';
  machineName?: string | null;
};

export type ProductionScheduleHistoryProgressResponse = {
  history: string[];
  progressBySeiban: Record<string, ProductionScheduleHistoryProgressEntry>;
  updatedAt: string | null;
};

export type ProductionScheduleSearchStateResponse = {
  state: ProductionScheduleSearchState | null;
  updatedAt: string | null;
  etag: string | null;
  locationScope?: {
    deviceScopeKey: string;
    siteKey: string;
  };
};

export async function getKioskProductionScheduleSearchState(): Promise<ProductionScheduleSearchStateResponse> {
  const response = await api.get<{
    state: ProductionScheduleSearchState | null;
    updatedAt: string | null;
    locationScope?: { deviceScopeKey: string; siteKey: string };
  }>('/kiosk/production-schedule/search-state');
  const etag = (response.headers?.etag as string | undefined) ?? null;
  return { ...response.data, etag };
}

export type ProductionScheduleSearchStateUpdatePayload = {
  state: ProductionScheduleSearchState;
  ifMatch: string;
};

export type ProductionScheduleSearchStateUpdateResponse = {
  state: ProductionScheduleSearchState;
  updatedAt: string;
  etag: string | null;
};

export async function setKioskProductionScheduleSearchState(
  payload: ProductionScheduleSearchStateUpdatePayload
): Promise<ProductionScheduleSearchStateUpdateResponse> {
  const { state, ifMatch } = payload;
  const response = await api.put<{ state: ProductionScheduleSearchState; updatedAt: string }>(
    '/kiosk/production-schedule/search-state',
    { state },
    {
      headers: {
        'If-Match': ifMatch,
      },
    }
  );
  const etag = (response.headers?.etag as string | undefined) ?? null;
  return { ...response.data, etag };
}

export async function getKioskProductionScheduleSearchHistory() {
  const { data } = await api.get<ProductionScheduleSearchHistory>('/kiosk/production-schedule/search-history');
  return data;
}

export async function getKioskProductionScheduleHistoryProgress() {
  const { data } = await api.get<ProductionScheduleHistoryProgressResponse>('/kiosk/production-schedule/history-progress');
  return data;
}

export async function setKioskProductionScheduleSearchHistory(history: string[]) {
  const { data } = await api.put<{ history: string[]; updatedAt: string }>(
    '/kiosk/production-schedule/search-history',
    { history }
  );
  return data;
}

export type KioskProductionScheduleSeibanMachineNamesResponse = {
  machineNames: Record<string, string | null>;
};

export async function postKioskProductionScheduleSeibanMachineNames(payload: { fseibans: string[] }) {
  const { data } = await api.post<KioskProductionScheduleSeibanMachineNamesResponse>(
    '/kiosk/production-schedule/seiban-machine-names',
    payload
  );
  return data;
}
