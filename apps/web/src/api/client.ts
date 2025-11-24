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
  const { data } = await api.get<{ employees: Employee[] }>('/employees');
  return data.employees;
}

export async function createEmployee(input: Partial<Employee>) {
  const { data } = await api.post<{ employee: Employee }>('/employees', input);
  return data.employee;
}

export async function updateEmployee(id: string, input: Partial<Employee>) {
  const { data } = await api.put<{ employee: Employee }>(`/employees/${id}`, input);
  return data.employee;
}

export async function deleteEmployee(id: string) {
  const { data } = await api.delete<{ employee: Employee }>(`/employees/${id}`);
  return data.employee;
}

export async function getItems() {
  const { data } = await api.get<{ items: Item[] }>('/items');
  return data.items;
}

export async function createItem(input: Partial<Item>) {
  const { data } = await api.post<{ item: Item }>('/items', input);
  return data.item;
}

export async function updateItem(id: string, input: Partial<Item>) {
  const { data } = await api.put<{ item: Item }>(`/items/${id}`, input);
  return data.item;
}

export async function deleteItem(id: string) {
  const { data } = await api.delete<{ item: Item }>(`/items/${id}`);
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

export async function getTransactions(
  page = 1,
  filters?: { startDate?: string; endDate?: string; employeeId?: string; itemId?: string; clientId?: string }
) {
  const { data } = await api.get<{ transactions: Transaction[]; page: number; total: number; pageSize: number }>(
    '/transactions',
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
  const { data } = await api.get<{ theme: string; greeting: string; idleTimeoutMs: number }>('/kiosk/config');
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

  const { data } = await api.post<{ jobId: string; summary: ImportSummary }>('/imports/master', formData, {
    headers: { 'Content-Type': 'multipart/form-data' }
  });
  return data;
}

export async function getImportJobs() {
  const { data } = await api.get<{ jobs: ImportJob[] }>('/imports/jobs');
  return data.jobs;
}
