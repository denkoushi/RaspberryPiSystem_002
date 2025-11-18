import axios from 'axios';
import type {
  AuthResponse,
  BorrowPayload,
  Employee,
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

export async function getTransactions(page = 1) {
  const { data } = await api.get<{ transactions: Transaction[]; page: number; total: number; pageSize: number }>(
    '/transactions',
    { params: { page } }
  );
  return data;
}

export async function getKioskConfig() {
  const { data } = await api.get<{ theme: string; greeting: string; idleTimeoutMs: number }>('/kiosk/config');
  return data;
}
