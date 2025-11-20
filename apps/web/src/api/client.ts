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

export function setAuthToken(token?: string) {
  if (token) {
    api.defaults.headers.common['Authorization'] = `Bearer ${token}`;
  } else {
    delete api.defaults.headers.common['Authorization'];
  }
}

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

export async function getActiveLoans(clientId?: string, clientKey?: string) {
  const { data } = await api.get<{ loans: Loan[] }>('/loans/active', {
    params: { clientId },
    headers: clientKey ? { 'x-client-key': clientKey } : undefined
  });
  return data.loans;
}

export async function borrowItem(payload: BorrowPayload, clientKey?: string) {
  const { data } = await api.post<{ loan: Loan }>('/borrow', payload, {
    headers: clientKey ? { 'x-client-key': clientKey } : undefined
  });
  return data.loan;
}

export async function returnLoan(payload: ReturnPayload, clientKey?: string) {
  const { data } = await api.post<{ loan: Loan }>('/return', payload, {
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
