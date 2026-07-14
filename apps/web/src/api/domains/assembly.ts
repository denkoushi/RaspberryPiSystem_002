import { api } from '../http';

import type {
  AssemblyCheckRecordDto,
  AssemblyCheckSummaryDto,
  AssemblyProcedureDocumentDto,
  AssemblyProcedureDocumentSummaryDto,
  AssemblyProcedureOrderDto,
  AssemblyProcedureOrderSaveInput,
  AssemblyProcedureSequenceDto,
  AssemblyLotCreateInput,
  AssemblyLotSummaryDto,
  AssemblyTemplateCreateInput,
  AssemblyTemplateDto,
  AssemblyTemplateSummaryDto,
  AssemblyTorqueRecordOutcome,
  AssemblySeibanCandidateDto,
  AssemblyWorkSessionDto,
  AssemblyWorkSessionSummaryDto,
  AssemblyWorkSessionStartInput,
} from '../../features/assembly/types';

export async function listAssemblySeibanCandidates(params: { prefix: string; limit?: number }) {
  const qs = new URLSearchParams({ prefix: params.prefix });
  if (params.limit) qs.set('limit', String(params.limit));
  const { data } = await api.get<{ candidates: AssemblySeibanCandidateDto[] }>(
    `/assembly/seiban-candidates?${qs.toString()}`
  );
  return data.candidates;
}

export async function listAssemblySeibanLotQuantities(productNos: string[]) {
  if (productNos.length === 0) return [] as Array<{ productNo: string; lotQty: number }>;
  const qs = new URLSearchParams({ productNos: productNos.join(',') });
  const { data } = await api.get<{ items: Array<{ productNo: string; lotQty: number }> }>(
    `/assembly/seiban-lot-quantities?${qs.toString()}`
  );
  return data.items;
}

export async function resolveAssemblyOperatorNfc(uid: string) {
  const { data } = await api.post<{ employeeId: string; displayName: string }>(
    '/assembly/operators/resolve-nfc',
    { uid }
  );
  return data;
}

export async function verifyAssemblyProcedureOrderAccessPassword(payload: { password: string }) {
  const { data } = await api.post<{ success: boolean }>(
    '/kiosk/assembly/procedure-order-settings/verify-access-password',
    payload
  );
  return data;
}

export async function getAssemblyProcedureOrder(machineName: string) {
  const qs = new URLSearchParams({ machineName });
  const { data } = await api.get<{ order: AssemblyProcedureOrderDto }>(
    `/assembly/procedure-orders?${qs.toString()}`
  );
  return data.order;
}

export async function saveAssemblyProcedureOrder(payload: AssemblyProcedureOrderSaveInput) {
  const { data } = await api.put<{ order: AssemblyProcedureOrderDto }>('/assembly/procedure-orders', payload);
  return data.order;
}

export async function getAssemblyWorkSessionProcedureSequence(sessionId: string) {
  const { data } = await api.get<{ sequence: AssemblyProcedureSequenceDto }>(
    `/assembly/work-sessions/${sessionId}/procedure-sequence`
  );
  return data.sequence;
}
export async function listAssemblyProcedureDocuments(params?: { q?: string; includeInactive?: boolean }) {
  const qs = new URLSearchParams();
  if (params?.q) qs.set('q', params.q);
  if (params?.includeInactive) qs.set('includeInactive', 'true');
  const suffix = qs.toString() ? `?${qs.toString()}` : '';
  const { data } = await api.get<{ documents: AssemblyProcedureDocumentDto[] }>(`/assembly/procedure-documents${suffix}`);
  return data.documents;
}

export async function listAssemblyProcedureDocumentSummaries(params?: {
  q?: string;
  includeInactive?: boolean;
  limit?: number;
}) {
  const qs = new URLSearchParams();
  if (params?.q) qs.set('q', params.q);
  if (params?.includeInactive) qs.set('includeInactive', 'true');
  if (params?.limit) qs.set('limit', String(params.limit));
  const suffix = qs.toString() ? `?${qs.toString()}` : '';
  const { data } = await api.get<{ documents: AssemblyProcedureDocumentSummaryDto[] }>(
    `/assembly/procedure-documents/summary${suffix}`
  );
  return data.documents;
}

export async function uploadAssemblyProcedureDocument(input: { name: string; file: File }) {
  const formData = new FormData();
  formData.append('name', input.name);
  formData.append('file', input.file);
  const { data } = await api.post<{ document: AssemblyProcedureDocumentDto }>('/assembly/procedure-documents', formData, {
    headers: { 'Content-Type': 'multipart/form-data' }
  });
  return data.document;
}

export async function renameAssemblyProcedureDocument(id: string, name: string) {
  const { data } = await api.patch<{ document: AssemblyProcedureDocumentDto }>(`/assembly/procedure-documents/${id}`, { name });
  return data.document;
}

export async function deleteAssemblyProcedureDocument(id: string) {
  await api.delete(`/assembly/procedure-documents/${id}`);
}

export async function publishAssemblyProcedureDocument(id: string) {
  const { data } = await api.post<{ document: AssemblyProcedureDocumentDto }>(
    `/assembly/procedure-documents/${id}/publish`
  );
  return data.document;
}

export async function unpublishAssemblyProcedureDocument(id: string) {
  const { data } = await api.post<{ document: AssemblyProcedureDocumentDto }>(
    `/assembly/procedure-documents/${id}/unpublish`
  );
  return data.document;
}

export async function listAssemblyTemplates(params?: {
  q?: string;
  modelCode?: string;
  procedurePattern?: string;
  procedureDocumentId?: string;
  procedureDocumentName?: string;
  includeInactive?: boolean;
}) {
  const qs = new URLSearchParams();
  if (params?.q) qs.set('q', params.q);
  if (params?.modelCode) qs.set('modelCode', params.modelCode);
  if (params?.procedurePattern) qs.set('procedurePattern', params.procedurePattern);
  if (params?.procedureDocumentId) qs.set('procedureDocumentId', params.procedureDocumentId);
  if (params?.procedureDocumentName) qs.set('procedureDocumentName', params.procedureDocumentName);
  if (params?.includeInactive) qs.set('includeInactive', 'true');
  const suffix = qs.toString() ? `?${qs.toString()}` : '';
  const { data } = await api.get<{ templates: AssemblyTemplateDto[] }>(`/assembly/templates${suffix}`);
  return data.templates;
}

export async function getAssemblyTemplate(id: string) {
  const { data } = await api.get<{ template: AssemblyTemplateDto }>(`/assembly/templates/${id}`);
  return data.template;
}

export async function listAssemblyTemplateSummaries(params?: {
  q?: string;
  modelCode?: string;
  procedurePattern?: string;
  procedureDocumentId?: string;
  procedureDocumentName?: string;
  includeInactive?: boolean;
  limit?: number;
}) {
  const qs = new URLSearchParams();
  if (params?.q) qs.set('q', params.q);
  if (params?.modelCode) qs.set('modelCode', params.modelCode);
  if (params?.procedurePattern) qs.set('procedurePattern', params.procedurePattern);
  if (params?.procedureDocumentId) qs.set('procedureDocumentId', params.procedureDocumentId);
  if (params?.procedureDocumentName) qs.set('procedureDocumentName', params.procedureDocumentName);
  if (params?.includeInactive) qs.set('includeInactive', 'true');
  if (params?.limit) qs.set('limit', String(params.limit));
  const suffix = qs.toString() ? `?${qs.toString()}` : '';
  const { data } = await api.get<{ templates: AssemblyTemplateSummaryDto[] }>(`/assembly/templates/summary${suffix}`);
  return data.templates;
}

export type AssemblyLibraryFilterField =
  | 'templateModelCode'
  | 'templateProcedureDocumentName'
  | 'procedureDocumentName';

export async function listAssemblyLibraryFilterOptions(params: {
  field: AssemblyLibraryFilterField;
  q?: string;
  includeInactive?: boolean;
  limit?: number;
}) {
  const qs = new URLSearchParams({ field: params.field });
  if (params.q) qs.set('q', params.q);
  if (params.includeInactive) qs.set('includeInactive', 'true');
  if (params.limit) qs.set('limit', String(params.limit));
  const { data } = await api.get<{ options: string[] }>(`/assembly/library/filter-options?${qs.toString()}`);
  return data.options;
}

export async function createAssemblyTemplate(payload: AssemblyTemplateCreateInput) {
  const { data } = await api.post<{ template: AssemblyTemplateDto }>('/assembly/templates', payload);
  return data.template;
}

export async function reviseAssemblyTemplate(id: string, payload: Partial<AssemblyTemplateCreateInput>) {
  const { data } = await api.post<{ template: AssemblyTemplateDto }>(`/assembly/templates/${id}/revise`, payload);
  return data.template;
}

export async function retireAssemblyTemplate(id: string) {
  await api.delete(`/assembly/templates/${id}`);
}

export async function startAssemblyWorkSession(payload: AssemblyWorkSessionStartInput) {
  const { data } = await api.post<{ session: AssemblyWorkSessionDto }>('/assembly/work-sessions', payload);
  return data.session;
}

export async function createAssemblyLot(payload: AssemblyLotCreateInput) {
  const { data } = await api.post<{ lot: AssemblyLotSummaryDto }>('/assembly/lots', payload);
  return data.lot;
}

export async function listAssemblyLotSummaries(params?: { productNo?: string; limit?: number }) {
  const qs = new URLSearchParams();
  if (params?.productNo) qs.set('productNo', params.productNo);
  if (params?.limit) qs.set('limit', String(params.limit));
  const suffix = qs.toString() ? `?${qs.toString()}` : '';
  const { data } = await api.get<{ lots: AssemblyLotSummaryDto[] }>(`/assembly/lots/summary${suffix}`);
  return data.lots;
}

export async function getAssemblyLot(id: string) {
  const { data } = await api.get<{ lot: AssemblyLotSummaryDto }>(`/assembly/lots/${id}`);
  return data.lot;
}

export async function startAssemblyLotSerial(lotId: string, lotSerialId: string) {
  const { data } = await api.post<{ session: AssemblyWorkSessionDto }>(
    `/assembly/lots/${lotId}/serials/${lotSerialId}/start`,
    {}
  );
  return data.session;
}

export async function listAssemblyWorkSessionSummaries(params?: {
  status?: 'in_progress' | 'completed' | 'cancelled' | 'all';
  productNo?: string;
  serialNo?: string;
  limit?: number;
}) {
  const qs = new URLSearchParams();
  if (params?.status) qs.set('status', params.status);
  if (params?.productNo) qs.set('productNo', params.productNo);
  if (params?.serialNo) qs.set('serialNo', params.serialNo);
  if (params?.limit) qs.set('limit', String(params.limit));
  const suffix = qs.toString() ? `?${qs.toString()}` : '';
  const { data } = await api.get<{ sessions: AssemblyWorkSessionSummaryDto[] }>(`/assembly/work-sessions/summary${suffix}`);
  return data.sessions;
}

export async function getAssemblyWorkSession(id: string) {
  const { data } = await api.get<{ session: AssemblyWorkSessionDto }>(`/assembly/work-sessions/${id}`);
  return data.session;
}

export async function recordAssemblyTorque(
  sessionId: string,
  payload: { value: number; source?: 'manual' | 'mock' | 'agent'; rawPayload?: unknown }
) {
  const { data } = await api.post<{ session: AssemblyWorkSessionDto; outcome: AssemblyTorqueRecordOutcome }>(
    `/assembly/work-sessions/${sessionId}/record-torque`,
    payload
  );
  return data;
}

export async function recordAssemblyCheck(
  sessionId: string,
  payload: { checkItemId: string; checked: boolean }
) {
  const { data } = await api.post<{ record: AssemblyCheckRecordDto; checkSummary: AssemblyCheckSummaryDto }>(
    `/assembly/work-sessions/${sessionId}/record-check`,
    payload
  );
  return data;
}

export async function advanceAssemblyArea(sessionId: string) {
  const { data } = await api.post<{ session: AssemblyWorkSessionDto }>(`/assembly/work-sessions/${sessionId}/advance-area`);
  return data.session;
}

export async function restartAssemblyArea(sessionId: string, payload?: { areaId?: string | null; reason?: string | null }) {
  const { data } = await api.post<{ session: AssemblyWorkSessionDto }>(
    `/assembly/work-sessions/${sessionId}/restart-area`,
    payload ?? {}
  );
  return data.session;
}

export async function completeAssemblyWorkSession(sessionId: string) {
  const { data } = await api.post<{ session: AssemblyWorkSessionDto }>(`/assembly/work-sessions/${sessionId}/complete`);
  return data.session;
}

export async function cancelAssemblyWorkSession(sessionId: string, reason?: string) {
  const { data } = await api.post<{ session: AssemblyWorkSessionDto }>(`/assembly/work-sessions/${sessionId}/cancel`, {
    reason
  });
  return data.session;
}

export async function downloadAssemblyWorkSessionXlsx(sessionId: string) {
  const { data } = await api.get<Blob>(`/assembly/work-sessions/${sessionId}/export.xlsx`, {
    responseType: 'blob'
  });
  const url = URL.createObjectURL(data);
  const a = document.createElement('a');
  a.href = url;
  a.download = `assembly-torque-${sessionId}.xlsx`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export async function verifyKioskAssemblyRecordApprovalAccessPassword(payload: { password: string }) {
  const { data } = await api.post<{ success: boolean }>(
    '/kiosk/assembly/record-approvals/verify-access-password',
    payload
  );
  return data;
}

export async function approveAssemblyWorkSessionRecordApproval(
  sessionId: string,
  payload: { approverEmployeeTagUid: string; comment?: string | null }
) {
  const { data } = await api.post<{ session: AssemblyWorkSessionDto }>(
    `/assembly/work-sessions/${sessionId}/record-approval/approve`,
    payload
  );
  return data.session;
}
