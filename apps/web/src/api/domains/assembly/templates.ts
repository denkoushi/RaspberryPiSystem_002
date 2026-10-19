import { api } from '../../http';

import type { AssemblyTemplateCreateInput, AssemblyTemplateDto, AssemblyTemplateSummaryDto, AssemblySeibanCandidateDto } from '../../../features/assembly/types';

export async function listAssemblySeibanCandidates(params: { prefix: string; limit?: number }) {
  const qs = new URLSearchParams({ prefix: params.prefix });
  if (params.limit) qs.set('limit', String(params.limit));
  const { data } = await api.get<{ candidates: AssemblySeibanCandidateDto[] }>(
    `/assembly/seiban-candidates?${qs.toString()}`
  );
  return data.candidates;
}

export type AssemblyMachineNameCandidatesDto = {
  candidates: string[];
  hasMore: boolean;
};

export async function listAssemblyMachineNameCandidates(params: {
  digitQuery?: string;
  q?: string;
  limit?: number;
} = {}): Promise<AssemblyMachineNameCandidatesDto> {
  const qs = new URLSearchParams();
  if (params.digitQuery) qs.set('digitQuery', params.digitQuery);
  if (params.q) qs.set('q', params.q);
  if (params.limit) qs.set('limit', String(params.limit));
  const suffix = qs.toString() ? `?${qs.toString()}` : '';
  const { data } = await api.get<AssemblyMachineNameCandidatesDto>(
    `/assembly/machine-name-candidates${suffix}`
  );
  return data;
}

export async function listAssemblySeibanLotQuantities(productNos: string[]) {
  if (productNos.length === 0) return [] as Array<{ productNo: string; lotQty: number }>;
  const qs = new URLSearchParams({ productNos: productNos.join(',') });
  const { data } = await api.get<{ items: Array<{ productNo: string; lotQty: number }> }>(
    `/assembly/seiban-lot-quantities?${qs.toString()}`
  );
  return data.items;
}

export async function verifyAssemblyTemplateAccessPassword(payload: { password: string }) {
  const { data } = await api.post<{ success: boolean }>(
    '/kiosk/assembly/templates/verify-access-password',
    payload
  );
  return data;
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
