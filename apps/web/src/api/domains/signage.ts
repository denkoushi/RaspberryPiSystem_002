import { readProductionBuildConfig } from '../../config/productionBuildConfig';
import { resolveClientKey } from '../../lib/client-key';
import { buildSignageCurrentImageUrl } from '../../lib/signage/buildSignageCurrentImageUrl';
import { api } from '../http';

// デジタルサイネージ関連の型定義
export interface SignageSlotConfig {
  pdfId?: string;
  csvDashboardId?: string;
  visualizationDashboardId?: string;
  displayMode?: 'SLIDESHOW' | 'SINGLE';
  slideInterval?: number | null;
  /** kiosk_progress_overview / kiosk_leader_order_cards / self_inspection_machine_board: キオスクと同じ deviceScopeKey */
  deviceScopeKey?: string;
  slideIntervalSeconds?: number;
  seibanPerPage?: number;
  /** kiosk_leader_order_cards / self_inspection_machine_board auto: 表示する資源CD（先頭から順） */
  resourceCds?: string[];
  /** kiosk_leader_order_cards: 1ページの資源カード数（1〜10・既定はグリッド満杯＝10） */
  cardsPerPage?: number;
  /** mobile_placement_parts_shelf_grid: ゾーンあたりの最大表示行数（省略時はサーバ既定） */
  maxItemsPerZone?: number;
  /**
   * self_inspection_machine_board の選定モード。
   * kiosk_active_sessions は現行管理 UI の標準値、auto_from_leaderboard_status は legacy wire 値。
   */
  targetMode?: 'manual_machine_name' | 'kiosk_active_sessions' | 'auto_from_leaderboard_status';
  /** self_inspection_machine_board manual: 機種名（生産日程 machineName と正規化比較） */
  machineName?: string;
  /** self_inspection_machine_board auto: 連結する機種数上限 */
  maxAutoMachines?: number;
  /** self_inspection_machine_board: 1ページの部品行数 */
  partsPerPage?: number;
  /** self_inspection_machine_board: 詳細ヒートストリップ対象部品数 */
  detailTopN?: number;
  /** web_page: 表示するページ撮影コンテンツ（SignageWebCapture）の ID */
  webCaptureId?: string;
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
    | 'self_inspection_machine_board'
    | 'web_page'
    | 'message';
  config: SignageSlotConfig | Record<string, never>;
}

export interface SignageCanvasElement {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  kind: 'text' | 'visualization';
  text?: string;
  title?: string;
  style?: {
    fontSize?: number;
    fontWeight?: 'normal' | '600' | '700';
    color?: string;
    align?: 'start' | 'middle' | 'end';
    verticalAlign?: 'top' | 'middle' | 'bottom';
  };
  dataSourceType?: string;
  dataSourceConfig?: Record<string, unknown>;
  rendererType?: string;
  rendererConfig?: Record<string, unknown>;
}

export interface SignageCanvasPreviewSpec {
  width: number;
  height: number;
  backgroundColor: string;
  elements: SignageCanvasElement[];
}

export type SignageLayoutConfig =
  | { layout: 'FULL' | 'SPLIT'; slots: SignageSlot[]; a2ui?: NonNullable<import('./assembly').BusinessHermesSignageProposal['a2ui']> }
  | { layout: 'CANVAS'; width: number; height: number; backgroundColor: string; elements: SignageCanvasElement[] };

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

/** 業務Hermesの提案キャンバスを保存せず、実データ込みのJPEGとして取得する。 */
export async function renderSignageCanvasPreview(spec: SignageCanvasPreviewSpec): Promise<Blob> {
  const { data } = await api.post<Blob>('/signage/canvas-preview', spec, {
    responseType: 'blob',
  });
  return data;
}

/** 可視化ダッシュボードのレンダリング画像URL（Web /signage 表示用） */
export function getSignageVisualizationImageUrl(dashboardId: string): string {
  const base = readProductionBuildConfig().apiBaseUrl;
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
  const base = readProductionBuildConfig().apiBaseUrl;
  const normalized = base.replace(/\/$/, '');
  const suffix = apiPath.startsWith('/api') ? apiPath.slice(4) : apiPath.startsWith('/') ? apiPath : `/${apiPath}`;
  return `${normalized}${suffix}`;
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

// ページ撮影コンテンツ（管理画面のページを撮ってサイネージに出す）
export type SignageWebCaptureWaitMode = 'network_idle' | 'fixed_delay';

export interface SignageWebCaptureSettings {
  path: string;
  viewportWidth: number;
  viewportHeight: number;
  waitMode: SignageWebCaptureWaitMode;
  waitSeconds: number;
  hideSelectors: string[];
  clipSelector: string | null;
}

export interface SignageWebCaptureInput extends SignageWebCaptureSettings {
  name: string;
  refreshIntervalSeconds: 60 | 300 | 900;
  enabled: boolean;
}

export interface SignageWebCapture extends SignageWebCaptureInput {
  id: string;
  lastCapturedAt: string | null;
  lastStatus: 'never' | 'success' | 'failed';
  lastError: string | null;
  lastDurationMs: number | null;
  createdAt: string;
  updatedAt: string;
}

/** プレビュー上で「隠す部分」に選べる領域 */
export interface SignageWebCaptureRegion {
  selector: string;
  label: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface SignageWebCapturePreview {
  imageDataUrl: string;
  regions: SignageWebCaptureRegion[];
  durationMs: number;
  /** autoHideLandmarks で自動的に隠したセレクタ */
  autoHiddenSelectors: string[];
  /** ページの最初の見出し（名前の初期値に使う） */
  pageTitle: string | null;
}

export async function getSignageWebCaptures() {
  const { data } = await api.get<{ webCaptures: SignageWebCapture[] }>('/signage/web-captures');
  return data.webCaptures;
}

export async function createSignageWebCapture(payload: SignageWebCaptureInput) {
  const { data } = await api.post<{ webCapture: SignageWebCapture }>('/signage/web-captures', payload);
  return data.webCapture;
}

export async function updateSignageWebCapture(id: string, payload: Partial<SignageWebCaptureInput>) {
  const { data } = await api.put<{ webCapture: SignageWebCapture }>(`/signage/web-captures/${id}`, payload);
  return data.webCapture;
}

export async function deleteSignageWebCapture(id: string) {
  await api.delete(`/signage/web-captures/${id}`);
}

export async function captureSignageWebCaptureNow(id: string) {
  const { data } = await api.post<{ webCapture: SignageWebCapture }>(`/signage/web-captures/${id}/capture`);
  return data.webCapture;
}

export async function previewSignageWebCapture(settings: SignageWebCaptureSettings, options: { autoHideLandmarks?: boolean } = {}) {
  const { data } = await api.post<SignageWebCapturePreview>('/signage/web-captures/capture-preview', {
    ...settings,
    autoHideLandmarks: options.autoHideLandmarks ?? false,
  });
  return data;
}

export async function getSignageWebCaptureImage(id: string): Promise<Blob> {
  const { data } = await api.get<Blob>(`/signage/web-captures/${id}/image`, { responseType: 'blob' });
  return data;
}

// サイネージ管理の概況（端末ごとの描画時刻と、端末が最後に画像を取りに来た時刻）
export interface SignageManagementOverview {
  generatedAt: string;
  renderIntervalSeconds: number;
  /** 同じ時間に複数の予定があるとき、1 件を映す秒数 */
  scheduleSwitchIntervalSeconds: number;
  clients: Array<{
    apiKey: string;
    renderedAt: string | null;
    lastFetchedAt: string | null;
    rotation: SignageRotation;
  }>;
}

/** 端末でいま順番に映している予定 */
export interface SignageRotation {
  scheduleIds: string[];
  currentIndex: number;
  secondsUntilSwitch: number | null;
  /** いまの時刻に当たる予定がなく、代わりの予定を映している */
  isFallback: boolean;
}

export async function getSignageManagementOverview() {
  const { data } = await api.get<SignageManagementOverview>('/signage/management/overview');
  return data;
}

export async function getSignageCsvDashboardPreviewImage(id: string): Promise<Blob> {
  const { data } = await api.get<Blob>(`/signage/preview/csv-dashboard/${id}`, { responseType: 'blob' });
  return data;
}
