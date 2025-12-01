import axios from 'axios';
import type {
  AuthResponse,
  BorrowPayload,
  Employee,
  ImportJob,
  ImportSummary,
  Item,
  Loan,
  ReturnPayload,
  Transaction
} from './types';

export interface PhotoBorrowPayload {
  employeeTagUid: string;
  clientId?: string;
  note?: string | null;
}

const apiBase = import.meta.env.VITE_API_BASE_URL ?? '/api';
const wsBase = import.meta.env.VITE_WS_BASE_URL ?? '/ws';

export const api = axios.create({
  baseURL: apiBase
});

// 各リクエストで確実に client-key を付与するためのヘルパー
const resolveClientKey = () => {
  if (typeof window === 'undefined') return 'client-demo-key';
  const savedKey = window.localStorage.getItem('kiosk-client-key');
  return savedKey && savedKey.length > 0 ? savedKey : 'client-demo-key';
};

export function setAuthToken(token?: string) {
  if (token) {
    api.defaults.headers.common['Authorization'] = `Bearer ${token}`;
  } else {
    delete api.defaults.headers.common['Authorization'];
  }
}

export function setClientKeyHeader(key?: string) {
  api.defaults.headers.common['x-client-key'] = key && key.length > 0 ? key : 'client-demo-key';
}

// 初期読み込み時に localStorage に保存済みのキーがあれば適用し、なければデフォルトを設定
if (typeof window !== 'undefined') {
  const savedKey = window.localStorage.getItem('kiosk-client-key') ?? undefined;
  setClientKeyHeader(savedKey);
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

export function getWebSocketUrl(path: string) {
  if (path.startsWith('ws')) return path;
  return `${wsBase}${path}`;
}

export async function loginRequest(body: { username: string; password: string }) {
  const { data } = await api.post<AuthResponse>('/auth/login', body);
  return data;
}

export async function getEmployees() {
  const { data } = await api.get<{ employees: Employee[] }>('/tools/employees');
  return data.employees;
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
  const { data } = await api.get<{ loans: Loan[] }>('/tools/loans/active', {
    params: { clientId },
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

export async function getKioskConfig() {
  const key = resolveClientKey();
  const { data } = await api.get<{ theme: string; greeting: string; idleTimeoutMs: number; defaultMode?: 'PHOTO' | 'TAG' }>('/kiosk/config', {
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

export interface FileAlert {
  id: string;
  type: string;
  message: string;
  details?: string;
  timestamp: string;
  acknowledged: boolean;
}

export interface ClientAlerts {
  alerts: {
    staleClients: number;
    errorLogs: number;
    fileAlerts: number;
    hasAlerts: boolean;
  };
  details: {
    staleClientIds: string[];
    recentErrors: Array<{
      clientId: string;
      message: string;
      createdAt: string;
    }>;
    fileAlerts: FileAlert[];
  };
}

export async function getClientAlerts() {
  const { data } = await api.get<{ requestId: string } & ClientAlerts>('/clients/alerts');
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

export interface SystemInfo {
  cpuTemp: number | null;
  cpuLoad: number;
  timestamp: string;
}

export async function getSystemInfo() {
  const { data } = await api.get<SystemInfo>('/system/system-info');
  return data;
}

// デジタルサイネージ関連の型定義
export interface SignageSchedule {
  id: string;
  name: string;
  contentType: 'TOOLS' | 'PDF' | 'SPLIT';
  pdfId: string | null;
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
  tools?: Array<{
    id: string;
    itemCode: string;
    name: string;
    thumbnailUrl: string | null;
  }>;
  pdf?: {
    id: string;
    name: string;
    pages: string[];
  } | null;
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
