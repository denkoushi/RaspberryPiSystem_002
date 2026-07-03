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
  /** self_inspection_machine_board: manual / auto 選定モード */
  targetMode?: 'manual_machine_name' | 'auto_from_leaderboard_status';
  /** self_inspection_machine_board manual: 機種名（生産日程 machineName と正規化比較） */
  machineName?: string;
  /** self_inspection_machine_board auto: 連結する機種数上限 */
  maxAutoMachines?: number;
  /** self_inspection_machine_board: 1ページの部品行数 */
  partsPerPage?: number;
  /** self_inspection_machine_board: 詳細ヒートストリップ対象部品数 */
  detailTopN?: number;
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
