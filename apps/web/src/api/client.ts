import axios from 'axios';

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
  RiggingStatus
} from './types';

const apiBase = import.meta.env.VITE_API_BASE_URL ?? '/api';
const wsBase = import.meta.env.VITE_WS_BASE_URL ?? '/ws';
export const DEFAULT_CLIENT_KEY =
  import.meta.env.VITE_DEFAULT_CLIENT_KEY ?? 'client-key-raspberrypi4-kiosk1';

export const api = axios.create({
  baseURL: apiBase
});

// 各リクエストで確実に client-key を付与するためのヘルパー
// useLocalStorageとの互換性を保つため、JSON.parseを試みてから生の値にフォールバック
const resolveClientKey = () => {
  if (typeof window === 'undefined') return DEFAULT_CLIENT_KEY;
  const savedKey = window.localStorage.getItem('kiosk-client-key');
  if (!savedKey || savedKey.length === 0) return DEFAULT_CLIENT_KEY;
  
  // useLocalStorageはJSON.stringifyで保存するので、まずJSON.parseを試みる
  try {
    const parsed = JSON.parse(savedKey);
    if (typeof parsed === 'string' && parsed.length > 0) {
      return parsed;
    }
  } catch {
    // JSON.parseに失敗した場合は生の値をそのまま使用
  }
  return savedKey || DEFAULT_CLIENT_KEY;
};

export function setAuthToken(token?: string) {
  if (token) {
    api.defaults.headers.common['Authorization'] = `Bearer ${token}`;
  } else {
    delete api.defaults.headers.common['Authorization'];
  }
}

export function setClientKeyHeader(key?: string) {
  api.defaults.headers.common['x-client-key'] = key && key.length > 0 ? key : DEFAULT_CLIENT_KEY;
}

const resetKioskClientKey = () => {
  if (typeof window === 'undefined') return;
  window.localStorage.removeItem('kiosk-client-key');
  window.localStorage.setItem('kiosk-client-key', JSON.stringify(DEFAULT_CLIENT_KEY));
  setClientKeyHeader(DEFAULT_CLIENT_KEY);
  if (window.location.pathname.startsWith('/kiosk')) {
    window.location.reload();
  }
};

// 初期読み込み時に localStorage に保存済みのキーがあれば適用し、なければデフォルトを設定
// useLocalStorageとの互換性を保つため、JSON形式で保存する
if (typeof window !== 'undefined') {
  window.localStorage.setItem('kiosk-client-key', JSON.stringify(DEFAULT_CLIENT_KEY));
  setClientKeyHeader(DEFAULT_CLIENT_KEY);
}

// すべてのリクエストで client-key を付与
api.interceptors.request.use((config) => {
  const key = resolveClientKey();
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

// キオスク専用の従業員リスト取得（x-client-key認証）
export async function getKioskEmployees(clientKey?: string) {
  const { data } = await api.get<{ employees: Array<{ id: string; displayName: string; department: string | null }> }>('/kiosk/employees', {
    headers: clientKey ? { 'x-client-key': clientKey } : undefined
  });
  return data.employees;
}

export interface ProductionScheduleRow {
  id: string;
  occurredAt: string;
  rowData: Record<string, unknown>;
  processingOrder?: number | null;
  processingType?: string | null;
  note?: string | null;
  dueDate?: string | null;
}

export interface ProductionScheduleListResponse {
  page: number;
  pageSize: number;
  total: number;
  rows: ProductionScheduleRow[];
}

export async function getKioskProductionSchedule(params?: {
  productNo?: string;
  q?: string;
  resourceCds?: string;
  resourceAssignedOnlyCds?: string;
  hasNoteOnly?: boolean;
  hasDueDateOnly?: boolean;
  page?: number;
  pageSize?: number;
}) {
  const { data } = await api.get<ProductionScheduleListResponse>('/kiosk/production-schedule', {
    params
  });
  return data;
}

export async function completeKioskProductionScheduleRow(rowId: string) {
  const { data } = await api.put<{ success: boolean; alreadyCompleted: boolean; rowData: Record<string, unknown> }>(`/kiosk/production-schedule/${rowId}/complete`, {});
  return data;
}

export async function getKioskProductionScheduleResources() {
  const { data } = await api.get<{ resources: string[] }>('/kiosk/production-schedule/resources');
  return data.resources;
}

export async function getKioskProductionScheduleOrderUsage(params?: { resourceCds?: string }) {
  const { data } = await api.get<{ usage: Record<string, number[]> }>('/kiosk/production-schedule/order-usage', {
    params
  });
  return data.usage;
}

export async function updateKioskProductionScheduleOrder(
  rowId: string,
  payload: { resourceCd: string; orderNumber: number | null }
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

export async function getKioskProductionScheduleSearchState() {
  const { data } = await api.get<{ state: ProductionScheduleSearchState | null; updatedAt: string | null }>(
    '/kiosk/production-schedule/search-state'
  );
  return data;
}

export async function setKioskProductionScheduleSearchState(state: ProductionScheduleSearchState) {
  const { data } = await api.put<{ state: ProductionScheduleSearchState; updatedAt: string }>(
    '/kiosk/production-schedule/search-state',
    { state }
  );
  return data;
}

export async function getKioskProductionScheduleSearchHistory() {
  const { data } = await api.get<ProductionScheduleSearchHistory>('/kiosk/production-schedule/search-history');
  return data;
}

export async function setKioskProductionScheduleSearchHistory(history: string[]) {
  const { data } = await api.put<{ history: string[]; updatedAt: string }>(
    '/kiosk/production-schedule/search-history',
    { history }
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

export async function getMeasuringInstrumentByTagUid(tagUid: string) {
  const { data } = await api.get<{ instrument: MeasuringInstrument }>(`/measuring-instruments/by-tag/${tagUid}`);
  return data.instrument;
}

// 吊具 API
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

export async function createInspectionItem(measuringInstrumentId: string, input: Partial<InspectionItem>) {
  const body = { ...input, measuringInstrumentId };
  const { data } = await api.post<{ inspectionItem: InspectionItem }>(
    `/measuring-instruments/${measuringInstrumentId}/inspection-items`,
    body
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
  const key = resolveClientKey();
  const { data } = await api.get<KioskConfig>('/kiosk/config', {
    headers: { 'x-client-key': key }
  });
  return data;
}

export interface ClientDevice {
  id: string;
  name: string;
  location?: string | null;
  apiKey: string;
  defaultMode?: 'PHOTO' | 'TAG' | null;
  lastSeenAt?: string | null;
  createdAt: string;
  updatedAt: string;
}

export async function getClients() {
  const { data } = await api.get<{ clients: ClientDevice[] }>('/clients');
  return data.clients;
}

export async function updateClient(id: string, payload: { defaultMode?: 'PHOTO' | 'TAG' | null }) {
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
  // #region agent log
  fetch('http://127.0.0.1:7242/ingest/efef6d23-e2ed-411f-be56-ab093f2725f8', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      sessionId: 'debug-session',
      runId: 'pre-fix',
      hypothesisId: 'H5',
      location: 'apps/web/src/api/client.ts:getClientAlerts',
      message: 'Fetching /clients/alerts',
      data: {},
      timestamp: Date.now(),
    }),
  }).catch(() => {});
  // #endregion

  const { data } = await api.get<{ requestId: string } & ClientAlerts>('/clients/alerts');

  // #region agent log
  fetch('http://127.0.0.1:7242/ingest/efef6d23-e2ed-411f-be56-ab093f2725f8', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      sessionId: 'debug-session',
      runId: 'pre-fix',
      hypothesisId: 'H1',
      location: 'apps/web/src/api/client.ts:getClientAlerts',
      message: 'Fetched /clients/alerts response summary',
      data: {
        requestId: data?.requestId,
        counts: {
          staleClients: data?.alerts?.staleClients,
          errorLogs: data?.alerts?.errorLogs,
          dbAlerts: data?.alerts?.dbAlerts,
          hasAlerts: data?.alerts?.hasAlerts,
        },
        dbAlertsTop: (data?.details?.dbAlerts ?? []).slice(0, 10).map((a) => ({
          id: a.id,
          type: a.type ?? null,
          severity: a.severity ?? null,
          timestamp: a.timestamp,
          acknowledged: a.acknowledged,
        })),
      },
      timestamp: Date.now(),
    }),
  }).catch(() => {});
  // #endregion

  return data;
}

export async function acknowledgeAlert(alertId: string) {
  // #region agent log
  fetch('http://127.0.0.1:7242/ingest/efef6d23-e2ed-411f-be56-ab093f2725f8', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      sessionId: 'debug-session',
      runId: 'pre-fix',
      hypothesisId: 'H4',
      location: 'apps/web/src/api/client.ts:acknowledgeAlert',
      message: 'POST /clients/alerts/:id/acknowledge start',
      data: { alertId },
      timestamp: Date.now(),
    }),
  }).catch(() => {});
  // #endregion

  const { data } = await api.post<{ requestId: string; acknowledged: boolean }>(
    `/clients/alerts/${alertId}/acknowledge`
  );

  // #region agent log
  fetch('http://127.0.0.1:7242/ingest/efef6d23-e2ed-411f-be56-ab093f2725f8', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      sessionId: 'debug-session',
      runId: 'pre-fix',
      hypothesisId: 'H4',
      location: 'apps/web/src/api/client.ts:acknowledgeAlert',
      message: 'POST /clients/alerts/:id/acknowledge success',
      data: { alertId, requestId: data?.requestId, acknowledged: data?.acknowledged },
      timestamp: Date.now(),
    }),
  }).catch(() => {});
  // #endregion

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
  type: 'employees' | 'items' | 'measuringInstruments' | 'riggingGears';
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
    'riggingGears': 'rigging-gears'
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
  kioskMaintenance: boolean;
  scope?: string;
  startedAt?: string;
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
}

export interface SignageSlot {
  position: 'FULL' | 'LEFT' | 'RIGHT';
  kind: 'pdf' | 'loans' | 'csv_dashboard' | 'visualization' | 'message';
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
    borrowedAt?: string | null;
    isInstrument?: boolean;
    managementNumber?: string | null;
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

export async function createSignageSchedule(payload: {
  name: string;
  contentType: 'TOOLS' | 'PDF' | 'SPLIT';
  pdfId?: string | null;
  layoutConfig?: SignageLayoutConfig | null;
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
