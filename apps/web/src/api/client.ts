import axios from 'axios';

import {
  DEFAULT_CLIENT_KEY,
  ensureClientKeyStorageInitialized,
  resolveClientKey,
  setClientKeyToStorage
} from '../lib/client-key';
import { buildSignageCurrentImageUrl } from '../lib/signage/buildSignageCurrentImageUrl';

import type {
  AuthResponse,
  MfaInitiateResponse,
  MfaActivateResponse,
  RoleAuditLog,
  BorrowPayload,
  Employee,
  ImportSummary,
  Item,
  Loan,
  ReturnPayload,
  Transaction,
  MeasuringInstrument,
  MeasuringInstrumentBorrowPayload,
  MeasuringInstrumentReturnPayload,
  MeasuringInstrumentGenre,
  MeasuringInstrumentStatus,
  InspectionItem,
  MeasuringInstrumentTag,
  InspectionRecord,
  InspectionRecordCreatePayload,
  RiggingGear,
  RiggingGearTag,
  RiggingBorrowPayload,
  RiggingReturnPayload,
  RiggingInspectionRecord,
  RiggingInspectionResult,
  RiggingLoanAnalyticsResponse,
  RiggingStatus,
  ItemLoanAnalyticsResponse,
  MeasuringInstrumentLoanAnalyticsResponse,
} from './types';
import type { PartPlacementSearchSuggestResponse } from '../features/mobile-placement/part-search/types';
import type { RegisteredShelfEntryDto } from '../features/mobile-placement/registeredShelves/types';
import type {
  FindOrOpenPartMeasurementResponse,
  PartMeasurementProcessGroup,
  PartMeasurementSheetDto,
  PartMeasurementSheetWithSession,
  PartMeasurementTemplateCandidateDto,
  PartMeasurementTemplateDto,
  PartMeasurementTemplateScope,
  PartMeasurementVisualTemplateDto,
  ResolveTicketResponse
} from '../features/part-measurement/types';
import type { PhotoToolVlmLabelProvenance } from '@raspi-system/shared-types';


const apiBase = import.meta.env.VITE_API_BASE_URL ?? '/api';
const wsBase = import.meta.env.VITE_WS_BASE_URL ?? '/ws';
export { DEFAULT_CLIENT_KEY };
const KIOSK_KEY_RESET_TS_KEY = 'kiosk-client-key-last-reset-at';
const KIOSK_KEY_RESET_COOLDOWN_MS = 30000;

export const api = axios.create({
  baseURL: apiBase
});

export function getResolvedClientKey() {
  return resolveClientKey({ allowDefaultFallback: true }).key;
}

export function setAuthToken(token?: string) {
  if (token) {
    api.defaults.headers.common['Authorization'] = `Bearer ${token}`;
  } else {
    delete api.defaults.headers.common['Authorization'];
  }
}

export function setClientKeyHeader(key?: string) {
  api.defaults.headers.common['x-client-key'] =
    key && key.length > 0 ? key : resolveClientKey({ allowDefaultFallback: true }).key;
}

const resetKioskClientKey = () => {
  if (typeof window === 'undefined') return;
  window.localStorage.removeItem('kiosk-client-key');
  const defaultKey = resolveClientKey({ allowDefaultFallback: true }).key;
  setClientKeyToStorage(defaultKey);
  setClientKeyHeader(defaultKey);

  // 同一セッションで短時間に401が続いた場合、リロードループを防ぐ。
  const now = Date.now();
  const lastResetAtRaw = window.sessionStorage.getItem(KIOSK_KEY_RESET_TS_KEY);
  const lastResetAt = lastResetAtRaw ? Number(lastResetAtRaw) : 0;
  window.sessionStorage.setItem(KIOSK_KEY_RESET_TS_KEY, String(now));

  if (window.location.pathname.startsWith('/kiosk')) {
    if (Number.isFinite(lastResetAt) && now - lastResetAt < KIOSK_KEY_RESET_COOLDOWN_MS) {
      return;
    }
    window.location.reload();
  }
};

// 初期読み込み時:
// - localStorage が未設定/空の場合のみデフォルトを設定（誤って他端末のキーを上書きしない）
// - 既に保存済みのキーがあればそれを適用する
// - Mac環境を検出して適切なデフォルト値を設定
// useLocalStorageとの互換性を保つため、JSON形式で保存する
if (typeof window !== 'undefined') {
  ensureClientKeyStorageInitialized();
  const resolved = resolveClientKey({ allowDefaultFallback: true }).key;
  setClientKeyHeader(resolved);
}

// すべてのリクエストで client-key を付与
api.interceptors.request.use((config) => {
  const key = resolveClientKey({ allowDefaultFallback: true }).key;
  config.headers = config.headers ?? {};
  if (!config.headers['x-client-key']) {
    config.headers['x-client-key'] = key;
  }
  return config;
});

api.interceptors.response.use(
  (response) => response,
  (error) => {
    const status = error?.response?.status;
    const code = error?.response?.data?.code;
    const message = error?.response?.data?.message;
    const isInvalidClientKey =
      code === 'INVALID_CLIENT_KEY' ||
      code === 'CLIENT_KEY_INVALID' ||
      (typeof message === 'string' && message.includes('無効なクライアントキー')) ||
      (typeof message === 'string' && message.includes('Invalid client key'));
    if (status === 401 && isInvalidClientKey) {
      resetKioskClientKey();
    }
    return Promise.reject(error);
  }
);

export function getWebSocketUrl(path: string) {
  if (path.startsWith('ws')) return path;
  return `${wsBase}${path}`;
}

export async function loginRequest(body: {
  username: string;
  password: string;
  totpCode?: string;
  backupCode?: string;
  rememberMe?: boolean;
}) {
  const { data } = await api.post<AuthResponse>('/auth/login', body);
  return data;
}

export async function mfaInitiate(): Promise<MfaInitiateResponse> {
  const { data } = await api.post<MfaInitiateResponse>('/auth/mfa/initiate', {});
  return data;
}

export async function mfaActivate(body: { secret: string; code: string; backupCodes: string[] }): Promise<MfaActivateResponse> {
  const { data } = await api.post<MfaActivateResponse>('/auth/mfa/activate', body);
  return data;
}

export async function mfaDisable(body: { password: string }): Promise<{ success: boolean }> {
  const { data } = await api.post<{ success: boolean }>('/auth/mfa/disable', body);
  return data;
}

export async function updateUserRole(userId: string, role: 'ADMIN' | 'MANAGER' | 'VIEWER') {
  const { data } = await api.post<{ user: AuthResponse['user'] }>(`/auth/users/${userId}/role`, { role });
  return data.user;
}

export async function getRoleAuditLogs(limit = 100) {
  const { data } = await api.get<{ logs: RoleAuditLog[] }>('/auth/role-audit', { params: { limit } });
  return data.logs;
}

export async function getDepartments(): Promise<{ departments: string[] }> {
  const response = await api.get<{ departments: string[] }>('/tools/departments');
  return response.data;
}

export async function getEmployees() {
  const { data } = await api.get<{ employees: Employee[] }>('/tools/employees');
  return data.employees;
}

export interface Machine {
  id: string;
  equipmentManagementNumber: string;
  name: string;
  shortName?: string | null;
  classification?: string | null;
  operatingStatus?: string | null;
  ncManual?: string | null;
  maker?: string | null;
  processClassification?: string | null;
  coolant?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface UninspectedMachinesResponse {
  date: string;
  csvDashboardId: string;
  totalRunningMachines: number;
  inspectedRunningCount: number;
  uninspectedCount: number;
  uninspectedMachines: Machine[];
}

export async function getMachines(params?: { search?: string; operatingStatus?: string }) {
  const { data } = await api.get<{ machines: Machine[] }>('/tools/machines', { params });
  return data.machines;
}

export async function getUninspectedMachines(params: { csvDashboardId: string; date?: string }) {
  const { data } = await api.get<UninspectedMachinesResponse>('/tools/machines/uninspected', { params });
  return data;
}

export interface CreateMachineInput {
  equipmentManagementNumber: string;
  name: string;
  shortName?: string;
  classification?: string;
  operatingStatus?: string;
  ncManual?: string;
  maker?: string;
  processClassification?: string;
  coolant?: string;
}

export interface UpdateMachineInput {
  name?: string;
  shortName?: string;
  classification?: string;
  operatingStatus?: string;
  ncManual?: string;
  maker?: string;
  processClassification?: string;
  coolant?: string;
}

export async function createMachine(input: CreateMachineInput) {
  const { data } = await api.post<{ machine: Machine }>('/tools/machines', input);
  return data.machine;
}

export async function updateMachine(id: string, input: UpdateMachineInput) {
  const { data } = await api.put<{ machine: Machine }>(`/tools/machines/${id}`, input);
  return data.machine;
}

export async function deleteMachine(id: string) {
  const { data } = await api.delete<{ success: boolean }>(`/tools/machines/${id}`);
  return data.success;
}

// キオスク専用の従業員リスト取得（x-client-key認証）
export async function getKioskEmployees(clientKey?: string) {
  const { data } = await api.get<{ employees: Array<{ id: string; displayName: string; department: string | null }> }>('/kiosk/employees', {
    headers: clientKey ? { 'x-client-key': clientKey } : undefined
  });
  return data.employees;
}

/** 購買照会（FKOBAINO）1行分 */
export interface PurchaseOrderLookupRowDto {
  seiban: string;
  purchasePartName: string;
  masterPartName: string;
  machineName: string;
  purchasePartCodeRaw: string;
  purchasePartCodeNormalized: string;
  acceptedQuantity: number;
  /** 生産日程補助の着手日（`YYYY-MM-DD`、無ければ null） */
  plannedStartDate: string | null;
}

export interface PurchaseOrderLookupResponse {
  purchaseOrderNo: string;
  rows: PurchaseOrderLookupRowDto[];
}

/** キオスク: 購買ナンバー（10桁）で照会 */
export async function getKioskPurchaseOrderLookup(purchaseOrderNo: string, clientKey?: string) {
  const { data } = await api.get<PurchaseOrderLookupResponse>(
    `/kiosk/purchase-order-lookup/${encodeURIComponent(purchaseOrderNo)}`,
    { headers: clientKey ? { 'x-client-key': clientKey } : undefined }
  );
  return data;
}

export interface ProductionScheduleRow {
  id: string;
  occurredAt: string;
  rowData: Record<string, unknown>;
  processingOrder?: number | null;
  globalRank?: number | null;
  actualPerPieceMinutes?: number | null;
  resolvedMachineName?: string | null;
  processingType?: string | null;
  note?: string | null;
  dueDate?: string | null;
  plannedQuantity?: number | null;
  plannedStartDate?: string | null;
  plannedEndDate?: string | null;
}

export interface ProductionScheduleListResponse {
  page: number;
  pageSize: number;
  total: number;
  rows: ProductionScheduleRow[];
}

export interface ProductionScheduleResourceCategorySettings {
  location: string;
  cuttingExcludedResourceCds: string[];
}

export interface ProductionScheduleDueManagementAccessPasswordSettings {
  location: string;
  configured: boolean;
  defaultPasswordActive: boolean;
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
  /** `leaderboard`: API が軽量プロファイルで応答（actual-hours / 機種名バッチ解決省略） */
  responseProfile?: 'full' | 'leaderboard';
}) {
  const { data } = await api.get<ProductionScheduleListResponse>('/kiosk/production-schedule', { params });
  return data;
}

/** 配膳スマホ: 生産スケジュール一覧（`/api/mobile-placement/schedule`、x-client-key 必須） */
/** GET /api/mobile-placement/registered-shelves（登録済み棚番候補） */
export type MobilePlacementRegisteredShelfEntry = RegisteredShelfEntryDto;

export async function getMobilePlacementRegisteredShelves() {
  const { data } = await api.get<{ shelves: RegisteredShelfEntryDto[] }>('/mobile-placement/registered-shelves');
  return data;
}

/** POST /api/mobile-placement/shelves（棚マスタへ新規登録、`西-北-01` 形式） */
export async function postMobilePlacementShelfRegister(payload: { shelfCodeRaw: string }) {
  const { data } = await api.post<{ shelf: RegisteredShelfEntryDto }>('/mobile-placement/shelves', payload);
  return data;
}

/** 部品名検索（現在棚優先・スケジュール補助）。機種名は登録製番ボタン下段と同系の MH/SH 由来。機種名のみでも可。 */
export async function getMobilePlacementPartSearchSuggest(q: string, machineName?: string) {
  const { data } = await api.get<PartPlacementSearchSuggestResponse>('/mobile-placement/part-search/suggest', {
    params: {
      q: q ?? '',
      ...(machineName != null && machineName.length > 0 ? { machineName } : {})
    }
  });
  return data;
}

export async function getMobilePlacementSchedule(params?: {
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
  targetDeviceScopeKey?: string;
}) {
  const { data } = await api.get<ProductionScheduleListResponse>('/mobile-placement/schedule', { params });
  return data;
}

export async function resolveMobilePlacementItem(barcode: string) {
  const { data } = await api.get<{
    item: { id: string; itemCode: string; name: string; storageLocation: string | null } | null;
    matchKind: 'itemCode' | 'none';
  }>('/mobile-placement/resolve-item', { params: { barcode } });
  return data;
}

export async function registerMobilePlacement(payload: {
  shelfCodeRaw: string;
  itemBarcodeRaw: string;
  csvDashboardRowId?: string;
}) {
  const { data } = await api.post<{
    event: {
      id: string;
      newStorageLocation: string;
      previousStorageLocation: string | null;
      itemId: string | null;
      shelfCodeRaw: string;
      itemBarcodeRaw: string;
    };
    item: { id: string; itemCode: string; name: string; storageLocation: string | null };
    resolveMatchKind: string;
  }>('/mobile-placement/register', payload);
  return data;
}

/** 移動票・現品票の (FSEIBAN, FHINCD) ペア照合 */
export async function verifyMobilePlacementSlipMatch(payload: {
  transferOrderBarcodeRaw: string;
  transferPartBarcodeRaw: string;
  /** 印字のみの場合は空でもよい（`actualFseibanRaw` とどちらか必須） */
  actualOrderBarcodeRaw: string;
  /** 製番。製造orderが空のときに日程解決に使う */
  actualFseibanRaw: string;
  actualPartBarcodeRaw: string;
}) {
  const { data } = await api.post<{ ok: true } | { ok: false; reason: string }>(
    '/mobile-placement/verify-slip-match',
    payload
  );
  return data;
}

/** 現品票画像を OCR し、製造order（10桁）と製番候補を返す */
export async function parseActualSlipImage(imageFile: File) {
  const form = new FormData();
  form.append('image', imageFile);
  const { data } = await api.post<{
    engine: string;
    ocrText: string;
    /** 数字・英数字 OCR のみ（プレビュー用。無い場合は `ocrText` を表示に使う） */
    ocrPreviewSafe: string | null;
    manufacturingOrder10: string | null;
    fseiban: string | null;
  }>('/mobile-placement/parse-actual-slip-image', form);
  return data;
}

/** 部品配膳（製造order番号・棚のみ。Item は更新しない） */
export async function registerOrderPlacement(payload: {
  shelfCodeRaw: string;
  manufacturingOrderBarcodeRaw: string;
}) {
  const { data } = await api.post<{
    event: {
      id: string;
      clientDeviceId: string;
      shelfCodeRaw: string;
      manufacturingOrderBarcodeRaw: string;
      csvDashboardRowId: string | null;
      branchNo: number;
      actionType: string;
      placedAt: string;
    };
    branchState: {
      id: string;
      branchNo: number;
      shelfCodeRaw: string;
    };
    resolvedRowId: string;
  }>('/mobile-placement/register-order-placement', payload);
  return data;
}

export type OrderPlacementBranchDto = {
  id: string;
  manufacturingOrderBarcodeRaw: string;
  branchNo: number;
  shelfCodeRaw: string;
  csvDashboardRowId: string | null;
  updatedAt: string;
};

/** 製造orderに紐づく分配枝の現在棚一覧 */
export async function getOrderPlacementBranches(manufacturingOrder: string) {
  const { data } = await api.get<{ branches: OrderPlacementBranchDto[] }>(
    '/mobile-placement/order-placement-branches',
    { params: { manufacturingOrder } }
  );
  return data;
}

/** 既存分配枝の棚を更新（移動） */
export async function moveOrderPlacementBranch(payload: {
  branchStateId: string;
  shelfCodeRaw: string;
}) {
  const { data } = await api.patch<{
    event: {
      id: string;
      clientDeviceId: string;
      shelfCodeRaw: string;
      manufacturingOrderBarcodeRaw: string;
      csvDashboardRowId: string | null;
      branchNo: number;
      actionType: string;
      placedAt: string;
    };
    branchState: {
      id: string;
      branchNo: number;
      shelfCodeRaw: string;
      updatedAt: string;
    };
  }>(`/mobile-placement/order-placement-branches/${payload.branchStateId}/move`, {
    shelfCodeRaw: payload.shelfCodeRaw
  });
  return data;
}

export interface KioskProductionScheduleOrderSearchResponse {
  partNameOptions: string[];
  orders: string[];
}

export async function completeKioskProductionScheduleRow(rowId: string) {
  const { data } = await api.put<{
    success: boolean;
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

export async function createEmployee(input: Partial<Employee>) {
  const { data } = await api.post<{ employee: Employee }>('/tools/employees', input);
  return data.employee;
}

export async function updateEmployee(id: string, input: Partial<Employee>) {
  const { data } = await api.put<{ employee: Employee }>(`/tools/employees/${id}`, input);
  return data.employee;
}

export async function deleteEmployee(id: string) {
  const { data } = await api.delete<{ employee: Employee }>(`/tools/employees/${id}`);
  return data.employee;
}

export async function getItems() {
  const { data } = await api.get<{ items: Item[] }>('/tools/items');
  return data.items;
}

export async function createItem(input: Partial<Item>) {
  const { data } = await api.post<{ item: Item }>('/tools/items', input);
  return data.item;
}

export async function updateItem(id: string, input: Partial<Item>) {
  const { data } = await api.put<{ item: Item }>(`/tools/items/${id}`, input);
  return data.item;
}

export async function deleteItem(id: string) {
  const { data } = await api.delete<{ item: Item }>(`/tools/items/${id}`);
  return data.item;
}

export async function getActiveLoans(clientId?: string, clientKey: string = 'client-demo-key') {
  // キオスク画面では全件表示するため、clientIdを送信しない
  // （API側でクライアントキーから自動解決されたclientIdでフィルタリングされないようにする）
  const { data } = await api.get<{ loans: Loan[] }>('/tools/loans/active', {
    params: clientId ? { clientId } : {}, // clientIdが明示的に指定されている場合のみ送信
    headers: { 'x-client-key': clientKey }
  });
  return data.loans;
}

export type PhotoLabelReviewQuality = 'GOOD' | 'MARGINAL' | 'BAD';

export type PhotoLabelReviewItem = {
  id: string;
  borrowedAt: string;
  photoUrl: string;
  photoToolDisplayName: string | null;
  photoToolVlmLabelProvenance: PhotoToolVlmLabelProvenance;
  photoToolHumanDisplayName: string | null;
  photoToolHumanQuality: PhotoLabelReviewQuality | null;
  photoToolHumanReviewedAt: string | null;
  employee: { id: string; displayName: string; employeeCode: string };
  client: { id: string; name: string; location: string | null } | null;
};

export async function listPhotoLabelReviews(limit = 50): Promise<PhotoLabelReviewItem[]> {
  const { data } = await api.get<{ items: PhotoLabelReviewItem[] }>('/tools/loans/photo-label-reviews', {
    params: { limit },
  });
  return data.items;
}

export type PhotoSimilarCandidate = {
  sourceLoanId: string;
  canonicalLabel: string;
  cosineDistance: number;
  score: number;
};

export async function getPhotoSimilarCandidates(loanId: string): Promise<PhotoSimilarCandidate[]> {
  const { data } = await api.get<{ candidates: PhotoSimilarCandidate[] }>(
    `/tools/loans/${loanId}/photo-similar-candidates`
  );
  return data.candidates;
}

export async function patchPhotoLabelReview(
  loanId: string,
  body: { quality: PhotoLabelReviewQuality; humanDisplayName?: string | null }
): Promise<PhotoLabelReviewItem> {
  const payload: { quality: PhotoLabelReviewQuality; humanDisplayName?: string | null } = {
    quality: body.quality,
  };
  if (Object.prototype.hasOwnProperty.call(body, 'humanDisplayName')) {
    payload.humanDisplayName = body.humanDisplayName ?? null;
  }
  const { data } = await api.patch<{ item: PhotoLabelReviewItem }>(
    `/tools/loans/${loanId}/photo-label-review`,
    payload
  );
  return data.item;
}

export type PhotoGallerySeedResult = {
  loanId: string;
  photoUrl: string;
  canonicalLabel: string;
};

export async function postPhotoGallerySeed(payload: {
  image: File;
  canonicalLabel: string;
}): Promise<PhotoGallerySeedResult> {
  const form = new FormData();
  form.append('image', payload.image);
  form.append('canonicalLabel', payload.canonicalLabel);
  const { data } = await api.post<PhotoGallerySeedResult>('/tools/loans/photo-gallery-seed', form);
  return data;
}

export async function borrowItem(payload: BorrowPayload, clientKey?: string) {
  const { data } = await api.post<{ loan: Loan }>('/tools/loans/borrow', payload, {
    headers: clientKey ? { 'x-client-key': clientKey } : undefined
  });
  return data.loan;
}

export async function returnLoan(payload: ReturnPayload, clientKey?: string) {
  const { data } = await api.post<{ loan: Loan }>('/tools/loans/return', payload, {
    headers: clientKey ? { 'x-client-key': clientKey } : undefined
  });
  return data.loan;
}

export async function deleteLoan(loanId: string, clientKey?: string) {
  const { data } = await api.delete<{ success: boolean }>(`/tools/loans/${loanId}`, {
    headers: clientKey ? { 'x-client-key': clientKey } : undefined
  });
  return data;
}

export interface CancelPayload {
  loanId: string;
  clientId?: string;
}

export async function cancelLoan(payload: CancelPayload, clientKey?: string) {
  const { data } = await api.post<{ loan: Loan }>('/tools/loans/cancel', payload, {
    headers: clientKey ? { 'x-client-key': clientKey } : undefined
  });
  return data.loan;
}

export interface PhotoBorrowPayload {
  employeeTagUid: string;
  photoData: string; // Base64エンコードされたJPEG画像データ
  clientId?: string;
  note?: string | null;
}

export async function photoBorrow(payload: PhotoBorrowPayload, clientKey?: string) {
  const { data } = await api.post<{ loan: Loan }>('/tools/loans/photo-borrow', payload, {
    headers: clientKey ? { 'x-client-key': clientKey } : undefined
  });
  return data.loan;
}

export async function getTransactions(
  page = 1,
  filters?: { startDate?: string; endDate?: string; employeeId?: string; itemId?: string; clientId?: string }
) {
  const { data } = await api.get<{ transactions: Transaction[]; page: number; total: number; pageSize: number }>(
    '/tools/transactions',
    {
      params: {
        page,
        startDate: filters?.startDate,
        endDate: filters?.endDate,
        employeeId: filters?.employeeId,
        itemId: filters?.itemId,
        clientId: filters?.clientId
      }
    }
  );
  return data;
}

// 計測機器 API
export async function getMeasuringInstruments(params?: {
  search?: string;
  status?: MeasuringInstrumentStatus;
}) {
  const { data } = await api.get<{ instruments: MeasuringInstrument[] }>('/measuring-instruments', {
    params
  });
  return data.instruments;
}

export interface UnifiedItem {
  id: string;
  type: 'TOOL' | 'MEASURING_INSTRUMENT' | 'RIGGING_GEAR';
  name: string;
  code: string;
  category?: string | null;
  storageLocation?: string | null;
  status: string;
  nfcTagUid?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface UnifiedListParams {
  search?: string;
  category?: 'TOOLS' | 'MEASURING_INSTRUMENTS' | 'RIGGING_GEARS' | 'ALL';
  itemStatus?: 'AVAILABLE' | 'IN_USE' | 'MAINTENANCE' | 'RETIRED';
  instrumentStatus?: 'AVAILABLE' | 'IN_USE' | 'MAINTENANCE' | 'RETIRED';
  riggingStatus?: 'AVAILABLE' | 'IN_USE' | 'MAINTENANCE' | 'RETIRED';
}

// 計測機器作成/更新用の入力
export type MeasuringInstrumentInput = Partial<MeasuringInstrument> & {
  rfidTagUid?: string | null;
};

export type MeasuringInstrumentGenreInput = {
  name: string;
};

export async function getUnifiedItems(params?: UnifiedListParams) {
  const { data } = await api.get<{ items: UnifiedItem[] }>('/tools/unified', {
    params: {
      ...params,
      category: params?.category ?? 'ALL'
    }
  });
  return data.items;
}

export async function getMeasuringInstrument(id: string) {
  const { data } = await api.get<{ instrument: MeasuringInstrument }>(`/measuring-instruments/${id}`);
  return data.instrument;
}

export async function getMeasuringInstrumentGenres() {
  const { data } = await api.get<{ genres: MeasuringInstrumentGenre[] }>('/measuring-instrument-genres');
  return data.genres;
}

export async function createMeasuringInstrumentGenre(input: MeasuringInstrumentGenreInput) {
  const { data } = await api.post<{ genre: MeasuringInstrumentGenre }>('/measuring-instrument-genres', input);
  return data.genre;
}

export async function updateMeasuringInstrumentGenre(
  genreId: string,
  input: Partial<Pick<MeasuringInstrumentGenre, 'name' | 'imageUrlPrimary' | 'imageUrlSecondary'>>
) {
  const { data } = await api.put<{ genre: MeasuringInstrumentGenre }>(`/measuring-instrument-genres/${genreId}`, input);
  return data.genre;
}

export async function deleteMeasuringInstrumentGenre(genreId: string) {
  const { data } = await api.delete<{ genre: MeasuringInstrumentGenre }>(`/measuring-instrument-genres/${genreId}`);
  return data.genre;
}

export async function uploadMeasuringInstrumentGenreImage(genreId: string, slot: 1 | 2, image: File) {
  const form = new FormData();
  form.append('image', image);
  const { data } = await api.post<{ genre: MeasuringInstrumentGenre }>(
    `/measuring-instrument-genres/${genreId}/images/${slot}`,
    form,
    {
      headers: { 'Content-Type': 'multipart/form-data' }
    }
  );
  return data.genre;
}

export async function deleteMeasuringInstrumentGenreImage(genreId: string, slot: 1 | 2) {
  const { data } = await api.delete<{ genre: MeasuringInstrumentGenre }>(
    `/measuring-instrument-genres/${genreId}/images/${slot}`
  );
  return data.genre;
}

export async function getMeasuringInstrumentByTagUid(tagUid: string) {
  const { data } = await api.get<{ instrument: MeasuringInstrument }>(`/measuring-instruments/by-tag/${tagUid}`);
  return data.instrument;
}

// 吊具 API
export async function getRiggingLoanAnalytics(params?: {
  periodFrom?: string;
  periodTo?: string;
  monthlyMonths?: number;
  timeZone?: 'Asia/Tokyo' | 'UTC';
  riggingGearId?: string;
}) {
  const { data } = await api.get<RiggingLoanAnalyticsResponse>('/rigging-gears/loan-analytics', { params });
  return data;
}

/** タグアイテム（itemId）の持出・返却集計。吊具・計測機器ローンは含まない */
export async function getItemLoanAnalytics(params?: {
  periodFrom?: string;
  periodTo?: string;
  monthlyMonths?: number;
  timeZone?: 'Asia/Tokyo' | 'UTC';
  itemId?: string;
}) {
  const { data } = await api.get<ItemLoanAnalyticsResponse>('/tools/items/loan-analytics', { params });
  return data;
}

export async function getMeasuringInstrumentLoanAnalytics(params?: {
  periodFrom?: string;
  periodTo?: string;
  monthlyMonths?: number;
  timeZone?: 'Asia/Tokyo' | 'UTC';
  measuringInstrumentId?: string;
}) {
  const { data } = await api.get<MeasuringInstrumentLoanAnalyticsResponse>('/measuring-instruments/loan-analytics', {
    params,
  });
  return data;
}

export async function getRiggingGears(params?: { search?: string; status?: RiggingStatus }) {
  const { data } = await api.get<{ riggingGears: RiggingGear[] }>('/rigging-gears', { params });
  return data.riggingGears;
}

export async function getRiggingGear(id: string) {
  const { data } = await api.get<{ riggingGear: RiggingGear }>(`/rigging-gears/${id}`);
  return data.riggingGear;
}

export async function getRiggingGearByTagUid(tagUid: string) {
  const { data } = await api.get<{ riggingGear: RiggingGear }>(`/rigging-gears/by-tag/${encodeURIComponent(tagUid)}`);
  return data.riggingGear;
}

export async function createRiggingGear(payload: Partial<RiggingGear> & { name: string; managementNumber: string }) {
  const { data } = await api.post<{ riggingGear: RiggingGear }>('/rigging-gears', payload);
  return data.riggingGear;
}

export async function updateRiggingGear(id: string, payload: Partial<RiggingGear>) {
  const { data } = await api.put<{ riggingGear: RiggingGear }>(`/rigging-gears/${encodeURIComponent(id)}`, payload);
  return data.riggingGear;
}

export async function deleteRiggingGear(id: string) {
  const { data } = await api.delete<{ riggingGear: RiggingGear }>(`/rigging-gears/${encodeURIComponent(id)}`);
  return data.riggingGear;
}

export async function setRiggingGearTag(riggingGearId: string, rfidTagUid: string) {
  const { data } = await api.post<{ tag: RiggingGearTag }>(`/rigging-gears/${encodeURIComponent(riggingGearId)}/tags`, {
    rfidTagUid
  });
  return data.tag;
}

export async function deleteRiggingGearTag(tagId: string) {
  const { data } = await api.delete<{ tag: RiggingGearTag }>(`/rigging-gear-tags/${encodeURIComponent(tagId)}`);
  return data.tag;
}

export async function createRiggingInspectionRecord(payload: {
  riggingGearId: string;
  loanId?: string | null;
  employeeId: string;
  result: RiggingInspectionResult;
  inspectedAt: string;
  notes?: string | null;
}) {
  const { data } = await api.post<{ inspectionRecord: RiggingInspectionRecord }>('/rigging-inspection-records', payload);
  return data.inspectionRecord;
}

export async function borrowRiggingGear(payload: RiggingBorrowPayload) {
  const { data } = await api.post<{ loan: Loan }>('/rigging-gears/borrow', payload);
  return data.loan;
}

export async function returnRiggingGear(payload: RiggingReturnPayload) {
  const { data } = await api.post<{ loan: Loan }>('/rigging-gears/return', payload);
  return data.loan;
}

export async function getMeasuringInstrumentTags(instrumentId: string) {
  const { data } = await api.get<{ tags: MeasuringInstrumentTag[] }>(`/measuring-instruments/${instrumentId}/tags`);
  return data;
}

export async function createMeasuringInstrument(input: MeasuringInstrumentInput) {
  const { data } = await api.post<{ instrument: MeasuringInstrument }>('/measuring-instruments', input);
  return data.instrument;
}

export async function updateMeasuringInstrument(id: string, input: MeasuringInstrumentInput) {
  const { data } = await api.put<{ instrument: MeasuringInstrument }>(`/measuring-instruments/${id}`, input);
  return data.instrument;
}

export async function deleteMeasuringInstrument(id: string) {
  const { data } = await api.delete<{ instrument: MeasuringInstrument }>(`/measuring-instruments/${id}`);
  return data.instrument;
}

// 点検項目 API
export async function getInspectionItems(measuringInstrumentId: string) {
  const { data } = await api.get<{ inspectionItems: InspectionItem[] }>(
    `/measuring-instruments/${measuringInstrumentId}/inspection-items`
  );
  return data.inspectionItems;
}

export async function getGenreInspectionItems(genreId: string) {
  const { data } = await api.get<{ inspectionItems: InspectionItem[] }>(
    `/measuring-instrument-genres/${genreId}/inspection-items`
  );
  return data.inspectionItems;
}

export async function createGenreInspectionItem(genreId: string, input: Partial<InspectionItem>) {
  const { data } = await api.post<{ inspectionItem: InspectionItem }>(
    `/measuring-instrument-genres/${genreId}/inspection-items`,
    input
  );
  return data.inspectionItem;
}

export async function getMeasuringInstrumentInspectionProfile(measuringInstrumentId: string) {
  const { data } = await api.get<{
    genre: MeasuringInstrumentGenre | null;
    inspectionItems: InspectionItem[];
  }>(`/measuring-instruments/${measuringInstrumentId}/inspection-profile`);
  return data;
}

export async function createInspectionItem(measuringInstrumentId: string, input: Partial<InspectionItem>) {
  const { data } = await api.post<{ inspectionItem: InspectionItem }>(
    `/measuring-instruments/${measuringInstrumentId}/inspection-items`,
    input
  );
  return data.inspectionItem;
}

export async function updateInspectionItem(itemId: string, input: Partial<InspectionItem>) {
  const { data } = await api.put<{ inspectionItem: InspectionItem }>(`/inspection-items/${itemId}`, input);
  return data.inspectionItem;
}

export async function deleteInspectionItem(itemId: string) {
  const { data } = await api.delete<{ inspectionItem: InspectionItem }>(`/inspection-items/${itemId}`);
  return data.inspectionItem;
}

// RFIDタグ API
export async function getInstrumentTags(measuringInstrumentId: string) {
  const { data } = await api.get<{ tags: MeasuringInstrumentTag[] }>(
    `/measuring-instruments/${measuringInstrumentId}/tags`
  );
  return data.tags;
}

export async function createInstrumentTag(measuringInstrumentId: string, rfidTagUid: string) {
  const { data } = await api.post<{ tag: MeasuringInstrumentTag }>(
    `/measuring-instruments/${measuringInstrumentId}/tags`,
    { rfidTagUid }
  );
  return data.tag;
}

export async function deleteInstrumentTag(tagId: string) {
  const { data } = await api.delete<{ tag: MeasuringInstrumentTag }>(`/measuring-instruments/tags/${tagId}`);
  return data.tag;
}

// 点検記録 API
export async function getInspectionRecords(
  measuringInstrumentId: string,
  filters?: { startDate?: string; endDate?: string; employeeId?: string; result?: string }
) {
  const { data } = await api.get<{ inspectionRecords: InspectionRecord[] }>(
    `/measuring-instruments/${measuringInstrumentId}/inspection-records`,
    { params: filters }
  );
  return data.inspectionRecords;
}

export async function createInspectionRecord(payload: InspectionRecordCreatePayload) {
  const { measuringInstrumentId, ...rest } = payload;
  const { data } = await api.post<{ inspectionRecord: InspectionRecord }>(
    `/measuring-instruments/${measuringInstrumentId}/inspection-records`,
    rest
  );
  return data.inspectionRecord;
}

// 計測機器の持出/返却
export async function borrowMeasuringInstrument(payload: MeasuringInstrumentBorrowPayload, clientKey?: string) {
  const { data } = await api.post<{ loan: Loan }>('/measuring-instruments/borrow', payload, {
    headers: clientKey ? { 'x-client-key': clientKey } : undefined
  });
  return data.loan;
}

export async function returnMeasuringInstrument(payload: MeasuringInstrumentReturnPayload, clientKey?: string) {
  const { data } = await api.post<{ loan: Loan }>('/measuring-instruments/return', payload, {
    headers: clientKey ? { 'x-client-key': clientKey } : undefined
  });
  return data.loan;
}

export async function resolvePartMeasurementTicket(
  body: {
    productNo: string;
    processGroup: PartMeasurementProcessGroup;
    scannedFhincd?: string | null;
    scannedBarcodeRaw?: string | null;
    resourceCd?: string | null;
  },
  clientKey?: string
): Promise<ResolveTicketResponse> {
  const { data } = await api.post<ResolveTicketResponse>('/part-measurement/resolve-ticket', body, {
    headers: clientKey ? { 'x-client-key': clientKey } : undefined
  });
  return data;
}

export async function findOrOpenPartMeasurementSheet(
  body: {
    productNo: string;
    processGroup: PartMeasurementProcessGroup;
    resourceCd: string;
    scheduleRowId?: string | null;
    fseiban?: string | null;
    fhincd?: string | null;
    fhinmei?: string | null;
    machineName?: string | null;
    scannedBarcodeRaw?: string | null;
  },
  clientKey?: string
): Promise<FindOrOpenPartMeasurementResponse> {
  const { data } = await api.post<FindOrOpenPartMeasurementResponse>(
    '/part-measurement/sheets/find-or-open',
    body,
    {
      headers: clientKey ? { 'x-client-key': clientKey } : undefined
    }
  );
  return data;
}

export async function createPartMeasurementSheet(
  body: {
    productNo: string;
    fseiban: string;
    fhincd: string;
    fhinmei: string;
    machineName?: string | null;
    resourceCdSnapshot?: string | null;
    processGroup: PartMeasurementProcessGroup;
    templateId: string;
    scannedBarcodeRaw?: string | null;
    scheduleRowId?: string;
    allowAlternateResourceTemplate?: boolean;
    sessionId?: string | null;
  },
  clientKey?: string
): Promise<PartMeasurementSheetWithSession> {
  const { data } = await api.post<PartMeasurementSheetWithSession>('/part-measurement/sheets', body, {
    headers: clientKey ? { 'x-client-key': clientKey } : undefined
  });
  return data;
}

export async function getPartMeasurementSheet(
  sheetId: string,
  clientKey?: string
): Promise<PartMeasurementSheetWithSession> {
  const { data } = await api.get<PartMeasurementSheetWithSession>(`/part-measurement/sheets/${sheetId}`, {
    headers: clientKey ? { 'x-client-key': clientKey } : undefined
  });
  return data;
}

export async function patchPartMeasurementSheet(
  sheetId: string,
  body: {
    quantity?: number | null;
    employeeTagUid?: string | null;
    clearEmployee?: boolean;
    results?: Array<{ pieceIndex: number; templateItemId: string; value?: string | number | null }>;
  },
  clientKey?: string
): Promise<PartMeasurementSheetWithSession> {
  const { data } = await api.patch<PartMeasurementSheetWithSession>(`/part-measurement/sheets/${sheetId}`, body, {
    headers: clientKey ? { 'x-client-key': clientKey } : undefined
  });
  return data;
}

export async function finalizePartMeasurementSheet(
  sheetId: string,
  clientKey?: string
): Promise<PartMeasurementSheetWithSession> {
  const { data } = await api.post<PartMeasurementSheetWithSession>(
    `/part-measurement/sheets/${sheetId}/finalize`,
    {},
    {
      headers: clientKey ? { 'x-client-key': clientKey } : undefined
    }
  );
  return data;
}

export async function listPartMeasurementDrafts(
  params: { limit?: number; cursor?: string },
  clientKey?: string
): Promise<{ sheets: PartMeasurementSheetDto[]; nextCursor: string | null }> {
  const { data } = await api.get<{ sheets: PartMeasurementSheetDto[]; nextCursor: string | null }>(
    '/part-measurement/sheets/drafts',
    {
      params,
      headers: clientKey ? { 'x-client-key': clientKey } : undefined
    }
  );
  return data;
}

export async function listPartMeasurementFinalized(
  params: {
    limit?: number;
    cursor?: string;
    productNo?: string;
    fseiban?: string;
    fhincd?: string;
    processGroup?: PartMeasurementProcessGroup;
    resourceCd?: string;
    dateFrom?: string;
    dateTo?: string;
    includeCancelled?: boolean;
    includeInvalidated?: boolean;
  },
  clientKey?: string
): Promise<{ sheets: PartMeasurementSheetDto[]; nextCursor: string | null }> {
  const { data } = await api.get<{ sheets: PartMeasurementSheetDto[]; nextCursor: string | null }>(
    '/part-measurement/sheets/finalized',
    {
      params,
      headers: clientKey ? { 'x-client-key': clientKey } : undefined
    }
  );
  return data;
}

export async function transferPartMeasurementEditLock(
  sheetId: string,
  body: { confirm?: boolean },
  clientKey?: string
): Promise<PartMeasurementSheetWithSession> {
  const { data } = await api.post<PartMeasurementSheetWithSession>(
    `/part-measurement/sheets/${sheetId}/transfer-edit-lock`,
    body,
    {
      headers: clientKey ? { 'x-client-key': clientKey } : undefined
    }
  );
  return data;
}

export async function cancelPartMeasurementSheet(
  sheetId: string,
  reason: string,
  clientKey?: string
): Promise<PartMeasurementSheetWithSession> {
  const { data } = await api.post<PartMeasurementSheetWithSession>(
    `/part-measurement/sheets/${sheetId}/cancel`,
    { reason },
    {
      headers: clientKey ? { 'x-client-key': clientKey } : undefined
    }
  );
  return data;
}

export async function downloadPartMeasurementSheetCsv(sheetId: string, clientKey: string, filename?: string): Promise<void> {
  const res = await fetch(`${apiBase}/part-measurement/sheets/${sheetId}/export.csv`, {
    headers: { 'x-client-key': clientKey }
  });
  if (!res.ok) {
    throw new Error(`CSV export failed: ${res.status}`);
  }
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename ?? `part-measurement-${sheetId}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

export async function listPartMeasurementTemplates(
  params?: {
    fhincd?: string;
    processGroup?: PartMeasurementProcessGroup;
    resourceCd?: string;
    includeInactive?: boolean;
  },
  clientKey?: string
): Promise<PartMeasurementTemplateDto[]> {
  const { data } = await api.get<{ templates: PartMeasurementTemplateDto[] }>('/part-measurement/templates', {
    params,
    headers: clientKey ? { 'x-client-key': clientKey } : undefined
  });
  return data.templates;
}

export async function listPartMeasurementTemplateCandidates(
  params: {
    fhincd: string;
    processGroup: PartMeasurementProcessGroup;
    resourceCd: string;
    fhinmei?: string;
    q?: string;
  },
  clientKey?: string
): Promise<PartMeasurementTemplateCandidateDto[]> {
  const { data } = await api.get<{ candidates: PartMeasurementTemplateCandidateDto[] }>(
    '/part-measurement/templates/candidates',
    {
      params,
      headers: clientKey ? { 'x-client-key': clientKey } : undefined
    }
  );
  return data.candidates;
}

/** 候補テンプレを日程の FIHNCD+工程+資源CD 用に複製（既存 active があればその ID を返す） */
export async function clonePartMeasurementTemplateForScheduleKey(
  body: {
    sourceTemplateId: string;
    fhincd: string;
    processGroup: PartMeasurementProcessGroup;
    resourceCd: string;
  },
  clientKey?: string
): Promise<PartMeasurementTemplateDto> {
  const { data } = await api.post<{
    template: PartMeasurementTemplateDto;
    reusedExistingActive: boolean;
    didClone: boolean;
  }>('/part-measurement/templates/clone-for-schedule-key', body, {
    headers: clientKey ? { 'x-client-key': clientKey } : undefined
  });
  return data.template;
}

export async function listPartMeasurementVisualTemplates(
  params?: { includeInactive?: boolean },
  clientKey?: string
): Promise<PartMeasurementVisualTemplateDto[]> {
  const { data } = await api.get<{ visualTemplates: PartMeasurementVisualTemplateDto[] }>(
    '/part-measurement/visual-templates',
    {
      params,
      headers: clientKey ? { 'x-client-key': clientKey } : undefined
    }
  );
  return data.visualTemplates;
}

export async function createPartMeasurementVisualTemplate(
  name: string,
  file: File,
  clientKey?: string
): Promise<PartMeasurementVisualTemplateDto> {
  const form = new FormData();
  form.append('name', name.trim() || '図面テンプレート');
  form.append('file', file);
  const { data } = await api.post<{ visualTemplate: PartMeasurementVisualTemplateDto }>(
    '/part-measurement/visual-templates',
    form,
    {
      headers: clientKey ? { 'x-client-key': clientKey } : undefined
    }
  );
  return data.visualTemplate;
}

export async function createPartMeasurementTemplate(
  body: {
    templateScope?: PartMeasurementTemplateScope;
    fhincd: string;
    processGroup: PartMeasurementProcessGroup;
    resourceCd: string;
    name: string;
    visualTemplateId?: string | null;
    candidateFhinmei?: string | null;
    items: Array<{
      sortOrder: number;
      datumSurface: string;
      measurementPoint: string;
      measurementLabel: string;
      displayMarker?: string | null;
      unit?: string | null;
      allowNegative?: boolean;
      decimalPlaces?: number;
    }>;
  },
  clientKey?: string
): Promise<PartMeasurementTemplateDto> {
  const { data } = await api.post<{ template: PartMeasurementTemplateDto }>('/part-measurement/templates', body, {
    headers: clientKey ? { 'x-client-key': clientKey } : undefined
  });
  return data.template;
}

/** 有効テンプレの系譜固定で次版を作成（FHINMEI_ONLY のとき候補キーも変更可） */
export async function revisePartMeasurementTemplate(
  templateId: string,
  body: {
    name: string;
    visualTemplateId?: string | null;
    candidateFhinmei?: string | null;
    items: Array<{
      sortOrder: number;
      datumSurface: string;
      measurementPoint: string;
      measurementLabel: string;
      displayMarker?: string | null;
      unit?: string | null;
      allowNegative?: boolean;
      decimalPlaces?: number;
    }>;
  },
  clientKey?: string
): Promise<PartMeasurementTemplateDto> {
  const { data } = await api.post<{ template: PartMeasurementTemplateDto }>(
    `/part-measurement/templates/${templateId}/revise`,
    body,
    {
      headers: clientKey ? { 'x-client-key': clientKey } : undefined
    }
  );
  return data.template;
}

/** 最新の有効版のみ論理削除（isActive を false。旧版は自動で有効化しない） */
export async function retirePartMeasurementTemplate(
  templateId: string,
  clientKey?: string
): Promise<PartMeasurementTemplateDto> {
  const { data } = await api.post<{ template: PartMeasurementTemplateDto }>(
    `/part-measurement/templates/${templateId}/retire`,
    {},
    {
      headers: clientKey ? { 'x-client-key': clientKey } : undefined
    }
  );
  return data.template;
}

export async function activatePartMeasurementTemplate(
  templateId: string,
  clientKey?: string
): Promise<PartMeasurementTemplateDto> {
  const { data } = await api.post<{ template: PartMeasurementTemplateDto }>(
    `/part-measurement/templates/${templateId}/activate`,
    {},
    {
      headers: clientKey ? { 'x-client-key': clientKey } : undefined
    }
  );
  return data.template;
}

export interface KioskConfig {
  theme: string;
  greeting: string;
  idleTimeoutMs: number;
  defaultMode?: 'PHOTO' | 'TAG';
  clientStatus?: {
    temperature: number | null;
    cpuUsage: number;
    lastSeen: string; // ISO date string
  } | null;
}

export async function getKioskConfig(): Promise<KioskConfig> {
  const key = resolveClientKey({ allowDefaultFallback: true }).key;
  const { data } = await api.get<KioskConfig>('/kiosk/config', {
    headers: { 'x-client-key': key }
  });
  return data;
}

export type KioskSignagePreviewCandidate = {
  id: string;
  name: string;
  location: string | null;
  apiKey: string;
};

export type KioskSignagePreviewOptionsResponse = {
  candidates: KioskSignagePreviewCandidate[];
  selectedApiKey: string | null;
  effectivePreviewApiKey: string;
};

export async function getKioskSignagePreviewOptions(): Promise<KioskSignagePreviewOptionsResponse> {
  const key = resolveClientKey({ allowDefaultFallback: true }).key;
  const { data } = await api.get<KioskSignagePreviewOptionsResponse>('/kiosk/signage-preview/options', {
    headers: { 'x-client-key': key },
  });
  return data;
}

export async function putKioskSignagePreviewSelection(payload: {
  signagePreviewTargetApiKey: string | null;
}): Promise<{ ok: true; signagePreviewTargetApiKey: string | null }> {
  const key = resolveClientKey({ allowDefaultFallback: true }).key;
  const { data } = await api.put<{ ok: true; signagePreviewTargetApiKey: string | null }>(
    '/kiosk/signage-preview/selection',
    payload,
    { headers: { 'x-client-key': key } }
  );
  return data;
}

export interface ClientDevice {
  id: string;
  name: string;
  location?: string | null;
  apiKey: string;
  defaultMode?: 'PHOTO' | 'TAG' | null;
  /** キオスクのサイネージプレビュー参照先（API が返す場合のみ） */
  signagePreviewTargetApiKey?: string | null;
  lastSeenAt?: string | null;
  createdAt: string;
  updatedAt: string;
}

export async function getClients() {
  const { data } = await api.get<{ clients: ClientDevice[] }>('/clients');
  return data.clients;
}

export async function updateClient(id: string, payload: { name?: string; defaultMode?: 'PHOTO' | 'TAG' | null }) {
  const { data } = await api.put<{ client: ClientDevice }>(`/clients/${id}`, payload);
  return data.client;
}

export type ClientLogLevel = 'DEBUG' | 'INFO' | 'WARN' | 'ERROR';

export interface ClientLogEntry {
  id?: string;
  clientId: string;
  level: ClientLogLevel;
  message: string;
  context?: Record<string, unknown> | null;
  createdAt: string;
}

export interface ClientStatusEntry {
  clientId: string;
  hostname: string;
  ipAddress: string;
  cpuUsage: number;
  memoryUsage: number;
  diskUsage: number;
  temperature?: number | null;
  uptimeSeconds?: number | null;
  lastBoot?: string | null;
  lastSeen: string;
  stale: boolean;
  latestLogs: Array<Pick<ClientLogEntry, 'level' | 'message' | 'createdAt'>>;
}

export async function getClientStatuses() {
  const { data } = await api.get<{ requestId: string; clients: ClientStatusEntry[] }>('/clients/status');
  return data.clients;
}

export interface KioskCallTarget {
  clientId: string;
  hostname: string;
  ipAddress: string;
  lastSeen: string;
  stale: boolean;
  name: string;
  location: string | null;
}

export async function getKioskCallTargets() {
  const { data } = await api.get<{ selfClientId: string | null; targets: KioskCallTarget[] }>('/kiosk/call/targets');
  return data;
}

export async function getClientLogs(filters?: {
  clientId?: string;
  level?: ClientLogLevel;
  limit?: number;
  since?: string;
}) {
  const { data } = await api.get<{ requestId: string; logs: ClientLogEntry[] }>('/clients/logs', {
    params: {
      clientId: filters?.clientId,
      level: filters?.level,
      limit: filters?.limit,
      since: filters?.since
    }
  });
  return data.logs;
}

// クライアントログを送信（デバッグ用）
export async function postClientLogs(
  payload: { clientId: string; logs: Array<{ level: ClientLogLevel; message: string; context?: Record<string, unknown> | null }> },
  clientKey?: string
) {
  const { data } = await api.post<{ requestId: string; logsStored: number }>('/clients/logs', payload, {
    headers: clientKey ? { 'x-client-key': clientKey } : undefined
  });
  return data;
}

// キオスクサポートメッセージを送信
export async function postKioskSupport(
  payload: { message: string; page: string },
  clientKey?: string
) {
  const { data } = await api.post<{ requestId: string }>('/kiosk/support', payload, {
    headers: clientKey ? { 'x-client-key': clientKey } : undefined
  });
  return data;
}

export async function postKioskPower(
  payload: { action: 'reboot' | 'poweroff' },
  clientKey?: string
) {
  const { data } = await api.post<{ requestId: string; action: string; status: string }>(
    '/kiosk/power',
    payload,
    {
      headers: clientKey ? { 'x-client-key': clientKey } : undefined
    }
  );
  return data;
}

/** パレット可視化（キオスク） */
export type PalletVisualizationItemDto = {
  id: string;
  machineCd: string;
  palletNo: number;
  displayOrder: number;
  fhincd: string;
  fhinmei: string;
  fseiban: string;
  machineName: string | null;
  machineNameDisplay: string | null;
  csvDashboardRowId: string | null;
  plannedStartDateDisplay: string | null;
  plannedQuantity: number | null;
  outsideDimensionsDisplay: string | null;
};

export type PalletVisualizationBoardResponseDto = {
  machines: Array<{
    machineCd: string;
    machineName: string;
    illustrationUrl: string | null;
    palletCount: number;
    pallets: Array<{ palletNo: number; items: PalletVisualizationItemDto[] }>;
  }>;
};

export async function getKioskPalletVisualizationBoard(clientKey?: string) {
  const { data } = await api.get<PalletVisualizationBoardResponseDto>('/kiosk/pallet-visualization/board', {
    headers: clientKey ? { 'x-client-key': clientKey } : undefined,
  });
  return data;
}

export async function getKioskPalletVisualizationHistory(
  params?: { limit?: number; cursor?: string },
  clientKey?: string
) {
  const { data } = await api.get<{
    events: Array<{
      id: string;
      actionType: string;
      machineCd: string;
      palletNo: number | null;
      affectedItemId: string | null;
      manufacturingOrderBarcodeRaw: string | null;
      illustrationRelativeUrl: string | null;
      createdAt: string;
    }>;
    nextCursor: string | null;
  }>('/kiosk/pallet-visualization/history', {
    params,
    headers: clientKey ? { 'x-client-key': clientKey } : undefined,
  });
  return data;
}

export async function postKioskPalletVisualizationItem(
  payload: { machineCd: string; palletNo: number; manufacturingOrderBarcodeRaw: string },
  clientKey?: string
) {
  const { data } = await api.post<{ id: string }>('/kiosk/pallet-visualization/items', payload, {
    headers: clientKey ? { 'x-client-key': clientKey } : undefined,
  });
  return data;
}

export async function postKioskPalletVisualizationItemReplace(
  itemId: string,
  payload: { manufacturingOrderBarcodeRaw: string },
  clientKey?: string
) {
  const { data } = await api.post<{ id: string }>(
    `/kiosk/pallet-visualization/items/${encodeURIComponent(itemId)}/replace`,
    payload,
    {
      headers: clientKey ? { 'x-client-key': clientKey } : undefined,
    }
  );
  return data;
}

export async function deleteKioskPalletVisualizationItem(itemId: string, clientKey?: string) {
  await api.delete(`/kiosk/pallet-visualization/items/${encodeURIComponent(itemId)}`, {
    headers: clientKey ? { 'x-client-key': clientKey } : undefined,
  });
}

export async function clearKioskPalletVisualizationPallet(
  machineCd: string,
  palletNo: number,
  clientKey?: string
) {
  await api.post(
    `/kiosk/pallet-visualization/machines/${encodeURIComponent(machineCd)}/pallets/${palletNo}/clear`,
    {},
    {
      headers: clientKey ? { 'x-client-key': clientKey } : undefined,
    }
  );
}

export async function getToolsPalletVisualizationBoard() {
  const { data } = await api.get<PalletVisualizationBoardResponseDto>('/tools/pallet-visualization/board');
  return data;
}

export async function postToolsPalletVisualizationIllustration(machineCd: string, file: File) {
  const formData = new FormData();
  formData.append('file', file);
  const { data } = await api.post<{ illustrationUrl: string }>(
    `/tools/pallet-visualization/machines/${encodeURIComponent(machineCd)}/illustration`,
    formData,
    { headers: { 'Content-Type': 'multipart/form-data' } }
  );
  return data;
}

export async function deleteToolsPalletVisualizationIllustration(machineCd: string) {
  await api.delete(`/tools/pallet-visualization/machines/${encodeURIComponent(machineCd)}/illustration`);
}

export async function patchToolsPalletMachinePalletCount(machineCd: string, palletCount: number) {
  await api.patch(
    `/tools/pallet-visualization/machines/${encodeURIComponent(machineCd)}/pallet-count`,
    { palletCount }
  );
}

export interface FileAlert {
  id: string;
  type: string;
  message: string;
  details?: string;
  timestamp: string;
  acknowledged: boolean;
}

export interface DbAlert {
  id: string;
  type?: string;
  message?: string;
  timestamp: string;
  acknowledged: boolean;
  severity?: string;
}

export interface ClientAlerts {
  alerts: {
    staleClients: number;
    errorLogs: number;
    fileAlerts: number; // deprecated: 互換性のため残す（常に0）
    dbAlerts: number;
    hasAlerts: boolean;
  };
  details: {
    staleClientIds: string[];
    recentErrors: Array<{
      clientId: string;
      message: string;
      createdAt: string;
    }>;
    fileAlerts: FileAlert[]; // deprecated: 互換性のため残す（常に空配列）
    dbAlerts: DbAlert[];
  };
}

export async function getClientAlerts() {
  const { data } = await api.get<{ requestId: string } & ClientAlerts>('/clients/alerts');
  return data;
}

export async function acknowledgeAlert(alertId: string) {
  const { data } = await api.post<{ requestId: string; acknowledged: boolean }>(
    `/clients/alerts/${alertId}/acknowledge`
  );
  return data;
}

interface ImportMasterPayload {
  employeesFile?: File | null;
  itemsFile?: File | null;
  replaceExisting?: boolean;
}

export async function importMaster(payload: ImportMasterPayload) {
  const formData = new FormData();
  if (payload.employeesFile) {
    formData.append('employees', payload.employeesFile);
  }
  if (payload.itemsFile) {
    formData.append('items', payload.itemsFile);
  }
  formData.append('replaceExisting', String(payload.replaceExisting ?? false));

  const { data } = await api.post<{ summary: ImportSummary }>('/imports/master', formData, {
    headers: { 'Content-Type': 'multipart/form-data' }
  });
  return data;
}

interface ImportMasterSinglePayload {
  type: 'employees' | 'items' | 'measuringInstruments' | 'riggingGears' | 'machines';
  file: File;
  replaceExisting?: boolean;
}

export async function importMasterSingle(payload: ImportMasterSinglePayload) {
  const formData = new FormData();
  formData.append('file', payload.file);
  formData.append('replaceExisting', String(payload.replaceExisting ?? false));

  // キャメルケースをケバブケースに変換
  const typeMap: Record<string, string> = {
    'employees': 'employees',
    'items': 'items',
    'measuringInstruments': 'measuring-instruments',
    'riggingGears': 'rigging-gears',
    'machines': 'machines'
  };
  const urlType = typeMap[payload.type] || payload.type;

  const { data } = await api.post<{ summary: Record<string, ImportSummary> }>(`/imports/master/${urlType}`, formData, {
    headers: { 'Content-Type': 'multipart/form-data' }
  });
  return data;
}

export interface SystemInfo {
  cpuTemp: number | null;
  cpuLoad: number;
  timestamp: string;
}

export async function getSystemInfo() {
  const { data } = await api.get<SystemInfo>('/system/system-info');
  return data;
}

export interface NetworkModeStatus {
  detectedMode: 'local' | 'maintenance';
  configuredMode: 'local' | 'maintenance';
  status: 'internet_connected' | 'local_network_only';
  checkedAt: string;
  latencyMs?: number;
  source?: string;
}

export async function getNetworkModeStatus() {
  const { data } = await api.get<NetworkModeStatus>('/system/network-mode');
  return data;
}

export interface DeployStatus {
  isMaintenance: boolean;
}

export async function getDeployStatus(): Promise<DeployStatus> {
  const { data } = await api.get<DeployStatus>('/system/deploy-status');
  return data;
}

// デジタルサイネージ関連の型定義
export interface SignageSlotConfig {
  pdfId?: string;
  csvDashboardId?: string;
  visualizationDashboardId?: string;
  displayMode?: 'SLIDESHOW' | 'SINGLE';
  slideInterval?: number | null;
  /** kiosk_progress_overview / kiosk_leader_order_cards: キオスクと同じ deviceScopeKey */
  deviceScopeKey?: string;
  slideIntervalSeconds?: number;
  seibanPerPage?: number;
  /** kiosk_leader_order_cards: 表示する資源CD（先頭から順） */
  resourceCds?: string[];
  /** kiosk_leader_order_cards: 1ページの資源カード数（1〜8・既定はグリッド満杯＝8） */
  cardsPerPage?: number;
  /** mobile_placement_parts_shelf_grid: ゾーンあたりの最大表示行数（省略時はサーバ既定） */
  maxItemsPerZone?: number;
}

export interface SignageSlot {
  position: 'FULL' | 'LEFT' | 'RIGHT';
  kind:
    | 'pdf'
    | 'loans'
    | 'csv_dashboard'
    | 'visualization'
    | 'kiosk_progress_overview'
    | 'kiosk_leader_order_cards'
    | 'mobile_placement_parts_shelf_grid'
    | 'message';
  config: SignageSlotConfig | Record<string, never>;
}

export interface SignageLayoutConfig {
  layout: 'FULL' | 'SPLIT';
  slots: SignageSlot[];
}

export interface SignageSchedule {
  id: string;
  name: string;
  contentType: 'TOOLS' | 'PDF' | 'SPLIT';
  pdfId: string | null;
  layoutConfig: SignageLayoutConfig | null;
  /** 空=全端末。値がある場合は列挙された client の apiKey（x-client-key）のみ */
  targetClientKeys?: string[];
  dayOfWeek: number[];
  startTime: string;
  endTime: string;
  priority: number;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface SignagePdf {
  id: string;
  name: string;
  filename: string;
  filePath: string;
  displayMode: 'SLIDESHOW' | 'SINGLE';
  slideInterval: number | null;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface SignageEmergency {
  id: string;
  message: string | null;
  contentType: 'TOOLS' | 'PDF' | 'SPLIT' | null;
  pdfId: string | null;
  enabled: boolean;
  expiresAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface SignageContentResponse {
  contentType: 'TOOLS' | 'PDF' | 'SPLIT';
  displayMode: 'SLIDESHOW' | 'SINGLE';
  layoutConfig?: SignageLayoutConfig;
  tools?: Array<{
    id: string;
    itemCode: string;
    name: string;
    thumbnailUrl: string | null;
    employeeName?: string | null;
    clientLocation?: string;
    borrowedAt?: string | null;
    isInstrument?: boolean;
    isRigging?: boolean;
    managementNumber?: string | null;
    idNum?: string | null;
  }>;
  measuringInstruments?: Array<{
    id: string;
    managementNumber: string;
    name: string;
    storageLocation: string | null;
    calibrationExpiryDate: string | null;
    status: string;
    isOverdue: boolean;
    isDueSoon: boolean;
  }>;
  pdf?: {
    id: string;
    name: string;
    pages: string[];
    slideInterval?: number | null;
  } | null;
  pdfsById?: Record<string, {
    id: string;
    name: string;
    pages: string[];
    slideInterval: number | null;
  }>;
  csvDashboardsById?: Record<string, {
    id: string;
    name: string;
    pageNumber: number;
    totalPages: number;
    rows: Array<Record<string, unknown>>;
  }>;
}

// デジタルサイネージ関連のAPI関数
export async function getSignageSchedules() {
  const { data } = await api.get<{ schedules: SignageSchedule[] }>('/signage/schedules');
  return data.schedules;
}

/** 管理画面用：有効/無効を含む全スケジュール */
export async function getSignageSchedulesForManagement() {
  const { data } = await api.get<{ schedules: SignageSchedule[] }>('/signage/schedules/management');
  return data.schedules;
}

export async function createSignageSchedule(payload: {
  name: string;
  contentType: 'TOOLS' | 'PDF' | 'SPLIT';
  pdfId?: string | null;
  layoutConfig?: SignageLayoutConfig | null;
  /** 省略または空=全端末 */
  targetClientKeys?: string[];
  dayOfWeek: number[];
  startTime: string;
  endTime: string;
  priority: number;
  enabled?: boolean;
}) {
  const { data } = await api.post<{ schedule: SignageSchedule }>('/signage/schedules', payload);
  return data.schedule;
}

export async function updateSignageSchedule(id: string, payload: Partial<{
  name: string;
  contentType: 'TOOLS' | 'PDF' | 'SPLIT';
  pdfId?: string | null;
  layoutConfig?: SignageLayoutConfig | null;
  targetClientKeys?: string[];
  dayOfWeek: number[];
  startTime: string;
  endTime: string;
  priority: number;
  enabled?: boolean;
}>) {
  const { data } = await api.put<{ schedule: SignageSchedule }>(`/signage/schedules/${id}`, payload);
  return data.schedule;
}

export async function deleteSignageSchedule(id: string) {
  await api.delete(`/signage/schedules/${id}`);
}

export async function getSignagePdfs() {
  const { data } = await api.get<{ pdfs: SignagePdf[] }>('/signage/pdfs');
  return data.pdfs;
}

export async function uploadSignagePdf(payload: {
  file: File;
  name: string;
  displayMode: 'SLIDESHOW' | 'SINGLE';
  slideInterval?: number | null;
}) {
  const formData = new FormData();
  formData.append('file', payload.file);
  formData.append('name', payload.name);
  formData.append('displayMode', payload.displayMode);
  if (payload.slideInterval !== undefined && payload.slideInterval !== null) {
    formData.append('slideInterval', String(payload.slideInterval));
  }

  const { data } = await api.post<{ pdf: SignagePdf }>('/signage/pdfs', formData, {
    headers: { 'Content-Type': 'multipart/form-data' }
  });
  return data.pdf;
}

export async function updateSignagePdf(id: string, payload: Partial<{
  name: string;
  displayMode: 'SLIDESHOW' | 'SINGLE';
  slideInterval?: number | null;
  enabled?: boolean;
}>) {
  const { data } = await api.put<{ pdf: SignagePdf }>(`/signage/pdfs/${id}`, payload);
  return data.pdf;
}

export async function deleteSignagePdf(id: string) {
  await api.delete(`/signage/pdfs/${id}`);
}

export async function getSignageEmergency() {
  const { data } = await api.get<{ enabled: boolean; message?: string | null; contentType?: 'TOOLS' | 'PDF' | 'SPLIT' | null; pdfId?: string | null; expiresAt?: string | null }>('/signage/emergency');
  return data;
}

export async function setSignageEmergency(payload: {
  message?: string | null;
  contentType?: 'TOOLS' | 'PDF' | 'SPLIT' | null;
  pdfId?: string | null;
  enabled?: boolean;
  expiresAt?: Date | null;
}) {
  const { data } = await api.post<{ emergency: SignageEmergency }>('/signage/emergency', payload);
  return data.emergency;
}

export async function getSignageContent() {
  const { data } = await api.get<SignageContentResponse>('/signage/content');
  return data;
}

/** 可視化ダッシュボードのレンダリング画像URL（Web /signage 表示用） */
export function getSignageVisualizationImageUrl(dashboardId: string): string {
  const base = import.meta.env.VITE_API_BASE_URL ?? '/api';
  const normalized = base.replace(/\/$/, '');
  return `${normalized}/signage/visualization-image/${dashboardId}`;
}

/**
 * Pi3 / ブラウザ共通の latest JPEG（キャッシュバスタ付き可）。
 * `<img src>` 用: 解決済み `clientKey` を必ずクエリ `key` に載せ、端末別レンダキャッシュと一致させる。
 */
export function getSignageCurrentImageUrl(
  cacheBust?: string | number,
  options?: {
    clientKey?: string;
    allowDefaultFallback?: boolean;
  }
): string {
  const key =
    options?.clientKey?.trim() ??
    resolveClientKey({ allowDefaultFallback: options?.allowDefaultFallback ?? true }).key;
  return buildSignageCurrentImageUrl({ clientKey: key, cacheBust });
}

/** 要領書PDFページ画像URL（/api/storage/pdf-pages/... をフルURL化） */
export function resolveKioskDocumentPageImageUrl(apiPath: string): string {
  const base = import.meta.env.VITE_API_BASE_URL ?? '/api';
  const normalized = base.replace(/\/$/, '');
  const suffix = apiPath.startsWith('/api') ? apiPath.slice(4) : apiPath.startsWith('/') ? apiPath : `/${apiPath}`;
  return `${normalized}${suffix}`;
}

export type KioskDocumentSource = 'MANUAL' | 'GMAIL';
export type KioskDocumentOcrStatus = 'PENDING' | 'PROCESSING' | 'COMPLETED' | 'FAILED';

export interface KioskDocumentSummary {
  id: string;
  title: string;
  displayTitle: string | null;
  filename: string;
  extractedText: string | null;
  ocrStatus: KioskDocumentOcrStatus;
  ocrEngine: string | null;
  ocrStartedAt: string | null;
  ocrFinishedAt: string | null;
  ocrRetryCount: number;
  ocrFailureReason: string | null;
  candidateFhincd: string | null;
  candidateDrawingNumber: string | null;
  candidateProcessName: string | null;
  candidateResourceCd: string | null;
  candidateDocumentNumber: string | null;
  summaryCandidate1: string | null;
  summaryCandidate2: string | null;
  summaryCandidate3: string | null;
  confidenceFhincd: number | null;
  confidenceDrawingNumber: number | null;
  confidenceProcessName: number | null;
  confidenceResourceCd: number | null;
  confidenceDocumentNumber: number | null;
  confirmedFhincd: string | null;
  confirmedDrawingNumber: string | null;
  confirmedProcessName: string | null;
  confirmedResourceCd: string | null;
  confirmedDocumentNumber: string | null;
  confirmedSummaryText: string | null;
  documentCategory: string | null;
  sourceType: KioskDocumentSource;
  gmailMessageId: string | null;
  sourceAttachmentName: string | null;
  pageCount: number | null;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface KioskDocumentDetailResponse {
  document: KioskDocumentSummary;
  pageUrls: string[];
}

export async function getKioskDocuments(params?: {
  q?: string;
  sourceType?: KioskDocumentSource;
  ocrStatus?: KioskDocumentOcrStatus;
  includeCandidates?: boolean;
  hideDisabled?: boolean;
}) {
  const { data } = await api.get<{ documents: KioskDocumentSummary[] }>('/kiosk-documents', {
    params: {
      q: params?.q,
      sourceType: params?.sourceType,
      ocrStatus: params?.ocrStatus,
      includeCandidates: params?.includeCandidates,
      hideDisabled: params?.hideDisabled,
    },
  });
  return data.documents;
}

export async function getKioskDocumentDetail(id: string) {
  const { data } = await api.get<KioskDocumentDetailResponse>(`/kiosk-documents/${id}`);
  return data;
}

export async function uploadKioskDocument(payload: { file: File; title?: string }) {
  const formData = new FormData();
  formData.append('file', payload.file);
  if (payload.title?.trim()) {
    formData.append('title', payload.title.trim());
  }
  const { data } = await api.post<KioskDocumentDetailResponse>('/kiosk-documents', formData);
  return data;
}

export async function deleteKioskDocument(id: string) {
  await api.delete(`/kiosk-documents/${id}`);
}

export async function patchKioskDocumentEnabled(id: string, enabled: boolean) {
  const { data } = await api.patch<{ document: KioskDocumentSummary }>(`/kiosk-documents/${id}`, { enabled });
  return data.document;
}

export async function patchKioskDocumentMetadata(
  id: string,
  payload: {
    displayTitle?: string | null;
    confirmedFhincd?: string | null;
    confirmedDrawingNumber?: string | null;
    confirmedProcessName?: string | null;
    confirmedResourceCd?: string | null;
    confirmedDocumentNumber?: string | null;
    confirmedSummaryText?: string | null;
    documentCategory?: string | null;
  }
) {
  const { data } = await api.patch<{ document: KioskDocumentSummary }>(`/kiosk-documents/${id}/metadata`, payload);
  return data.document;
}

export async function triggerKioskDocumentGmailIngest(params?: { scheduleId?: string }) {
  const { data } = await api.post<{ results: unknown[] }>('/kiosk-documents/ingest-gmail', params ?? {});
  return data.results;
}

export async function reprocessKioskDocument(id: string) {
  const { data } = await api.post<KioskDocumentDetailResponse>(`/kiosk-documents/${id}/reprocess`, {});
  return data;
}

// CSVダッシュボード関連の型定義
export interface CsvDashboard {
  id: string;
  name: string;
  description: string | null;
  columnDefinitions: Array<{
    internalName: string;
    displayName: string;
    csvHeaderCandidates: string[];
    dataType: 'string' | 'number' | 'date' | 'boolean';
    order: number;
    required?: boolean;
  }>;
  dateColumnName: string | null;
  displayPeriodDays: number;
  emptyMessage: string | null;
  ingestMode: 'APPEND' | 'DEDUP';
  dedupKeyColumns: string[];
  gmailScheduleId: string | null;
  gmailSubjectPattern: string | null; // Gmail件名パターン（CSV取得用）
  templateType: 'TABLE' | 'CARD_GRID';
  templateConfig: Record<string, unknown>;
  csvFilePath: string | null;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface VisualizationDashboard {
  id: string;
  name: string;
  description: string | null;
  dataSourceType: string;
  rendererType: string;
  dataSourceConfig: Record<string, unknown>;
  rendererConfig: Record<string, unknown>;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface VisualizationDashboardCreateInput {
  name: string;
  description?: string | null;
  dataSourceType: string;
  rendererType: string;
  dataSourceConfig: Record<string, unknown>;
  rendererConfig: Record<string, unknown>;
  enabled?: boolean;
}

export interface VisualizationDashboardUpdateInput {
  name?: string;
  description?: string | null;
  dataSourceType?: string;
  rendererType?: string;
  dataSourceConfig?: Record<string, unknown>;
  rendererConfig?: Record<string, unknown>;
  enabled?: boolean;
}

export interface CsvPreviewResult {
  headers: string[];
  sampleRows: Array<Record<string, unknown>>;
  detectedTypes: Record<string, 'string' | 'number' | 'date' | 'boolean'>;
}

export async function getCsvDashboards(filters?: { enabled?: boolean; search?: string }) {
  const params = new URLSearchParams();
  if (filters?.enabled !== undefined) {
    params.append('enabled', String(filters.enabled));
  }
  if (filters?.search) {
    params.append('search', filters.search);
  }
  const { data } = await api.get<{ dashboards: CsvDashboard[] }>(`/csv-dashboards?${params.toString()}`);
  return data.dashboards;
}

export async function getVisualizationDashboards(filters?: { enabled?: boolean; search?: string }) {
  const params = new URLSearchParams();
  if (filters?.enabled !== undefined) {
    params.append('enabled', String(filters.enabled));
  }
  if (filters?.search) {
    params.append('search', filters.search);
  }
  const { data } = await api.get<{ dashboards: VisualizationDashboard[] }>(`/visualizations?${params.toString()}`);
  return data.dashboards;
}

export async function getVisualizationDashboard(id: string) {
  const { data } = await api.get<{ dashboard: VisualizationDashboard }>(`/visualizations/${id}`);
  return data.dashboard;
}

export async function createVisualizationDashboard(payload: VisualizationDashboardCreateInput) {
  const { data } = await api.post<{ dashboard: VisualizationDashboard }>('/visualizations', payload);
  return data.dashboard;
}

export async function updateVisualizationDashboard(id: string, payload: VisualizationDashboardUpdateInput) {
  const { data } = await api.put<{ dashboard: VisualizationDashboard }>(`/visualizations/${id}`, payload);
  return data.dashboard;
}

export async function deleteVisualizationDashboard(id: string) {
  const { data } = await api.delete<{ success: true }>(`/visualizations/${id}`);
  return data;
}

export async function getCsvDashboard(id: string) {
  const { data } = await api.get<{ dashboard: CsvDashboard }>(`/csv-dashboards/${id}`);
  return data.dashboard;
}

export interface CsvDashboardCreateInput {
  name: string;
  description?: string | null;
  columnDefinitions: CsvDashboard['columnDefinitions'];
  dateColumnName?: string | null;
  displayPeriodDays?: number;
  emptyMessage?: string | null;
  ingestMode?: 'APPEND' | 'DEDUP';
  dedupKeyColumns?: string[];
  gmailScheduleId?: string | null;
  gmailSubjectPattern?: string | null;
  templateType?: 'TABLE' | 'CARD_GRID';
  templateConfig: Record<string, unknown>;
}

export async function createCsvDashboard(payload: CsvDashboardCreateInput) {
  const { data } = await api.post<{ dashboard: CsvDashboard }>('/csv-dashboards', payload);
  return data.dashboard;
}

export async function updateCsvDashboard(
  id: string,
  payload: Partial<Pick<CsvDashboard, 'name' | 'description' | 'columnDefinitions' | 'dateColumnName' | 'displayPeriodDays' | 'emptyMessage' | 'ingestMode' | 'dedupKeyColumns' | 'gmailScheduleId' | 'gmailSubjectPattern' | 'templateType' | 'templateConfig' | 'enabled'>>
) {
  const { data } = await api.put<{ dashboard: CsvDashboard }>(`/csv-dashboards/${id}`, payload);
  return data.dashboard;
}

export async function uploadCsvToDashboard(id: string, file: File) {
  const formData = new FormData();
  formData.append('file', file);
  const { data } = await api.post<{ preview: unknown; ingestResult: unknown }>(`/csv-dashboards/${id}/upload`, formData, {
    headers: { 'Content-Type': 'multipart/form-data' },
  });
  return data;
}

export async function previewCsvDashboardParse(id: string, csvContent: string) {
  const { data } = await api.post<{ preview: CsvPreviewResult }>(`/csv-dashboards/${id}/preview-parse`, { csvContent });
  return data.preview;
}

export interface SignageRenderResult {
  renderedAt: string;
  filename: string;
}

export async function renderSignage() {
  const { data } = await api.post<SignageRenderResult>('/signage/render');
  return data;
}

export interface SignageRenderStatus {
  isRunning: boolean;
  intervalSeconds: number;
}

export async function getSignageRenderStatus() {
  const { data } = await api.get<SignageRenderStatus>('/signage/render/status');
  return data;
}

export type {
  FindOrOpenPartMeasurementResponse,
  PartMeasurementProcessGroup,
  PartMeasurementSheetDto,
  PartMeasurementSheetWithSession,
  PartMeasurementTemplateDto,
  PartMeasurementTemplateScope,
  PartMeasurementVisualTemplateDto,
  ResolveTicketResponse
} from '../features/part-measurement/types';
