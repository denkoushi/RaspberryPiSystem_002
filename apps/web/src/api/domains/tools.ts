import { api } from '../http';

import type {
  BorrowPayload,
  Employee,
  Item,
  Loan,
  ReturnPayload,
  Transaction,
} from '../types';
import type { PhotoToolVlmLabelProvenance } from '@raspi-system/shared-types';
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
  idempotencyKey?: string;
}

export async function photoBorrow(payload: PhotoBorrowPayload, clientKey?: string) {
  const { idempotencyKey, ...body } = payload;
  const { data } = await api.post<{ loan: Loan }>('/tools/loans/photo-borrow', body, {
    headers: {
      ...(clientKey ? { 'x-client-key': clientKey } : {}),
      ...(idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {}),
    }
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
