import { isAxiosError } from 'axios';

import { api } from '../../http';

export const DUE_MANAGEMENT_AUTH_SESSION_KEY = 'kiosk-due-management-authenticated';

export const DUE_MANAGEMENT_TOKEN_SESSION_KEY = 'kiosk-due-management-token';

async function dueManagementMutation<T>(url: string, payload: unknown) {
  const token = typeof window !== 'undefined' ? window.sessionStorage.getItem(DUE_MANAGEMENT_TOKEN_SESSION_KEY) : null;
  try {
    return await api.put<T>(url, payload, { headers: token ? { 'x-due-management-token': token } : {} });
  } catch (error) {
    if (
      isAxiosError(error) && error.response?.status === 403 &&
      ['DUE_MANAGEMENT_TOKEN_REQUIRED', 'DUE_MANAGEMENT_TOKEN_INVALID', 'DUE_MANAGEMENT_TOKEN_EXPIRED',
        'DUE_MANAGEMENT_TOKEN_DEVICE_MISMATCH'].includes(error.response.data?.code) &&
      typeof window !== 'undefined'
    ) {
      window.sessionStorage.removeItem(DUE_MANAGEMENT_AUTH_SESSION_KEY);
      window.sessionStorage.removeItem(DUE_MANAGEMENT_TOKEN_SESSION_KEY);
    }
    throw error;
  }
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
  const { data } = await dueManagementMutation<
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
  const { data } = await dueManagementMutation<
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
  const { data } = await dueManagementMutation<ProductionScheduleDueManagementGlobalRankAutoGenerateResult>(
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
  const { data } = await dueManagementMutation<{
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
  const { data } = await dueManagementMutation<{ success: boolean; fhincd: string; processingType: string | null }>(
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
  const { data } = await dueManagementMutation<{ success: boolean; fseiban: string; fhincd: string; note: string | null }>(
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
  const { data } = await dueManagementMutation<{ success: boolean; selectedFseibans: string[] }>(
    '/kiosk/production-schedule/due-management/triage/selection',
    payload
  );
  return data;
}

export async function verifyKioskDueManagementAccessPassword(payload: { password: string }) {
  const { data } = await api.post<{ success: boolean; token?: string }>(
    '/kiosk/production-schedule/due-management/verify-access-password',
    payload
  );
  return data;
}
