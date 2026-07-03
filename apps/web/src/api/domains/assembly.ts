import { api } from '../http';

import type {
  AssemblyProcedureDocumentDto,
  AssemblyProcedureDocumentSummaryDto,
  AssemblyTemplateCreateInput,
  AssemblyTemplateDto,
  AssemblyTemplateSummaryDto,
  AssemblyTorqueRecordOutcome,
  AssemblyWorkSessionDto,
  AssemblyWorkSessionStartInput,
} from '../../features/assembly/types';
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
