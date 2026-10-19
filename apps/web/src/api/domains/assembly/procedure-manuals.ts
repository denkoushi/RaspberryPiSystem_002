import { api } from '../../http';

export async function listProcedureManualProcesses() {
  const { data } = await api.get<{ processes: import('../../../features/assembly/types').ProcedureManualProcessDto[] }>('/assembly/procedure-manuals/processes');
  return data.processes;
}

export async function listProcedureManualModels() {
  const { data } = await api.get<{ models: import('../../../features/assembly/types').ProcedureManualModelDto[] }>('/assembly/procedure-manuals/models');
  return data.models;
}

export async function listProcedureManualParts() {
  const { data } = await api.get<{ parts: { partNumber: string; partNumberKey: string }[] }>('/assembly/procedure-manuals/parts');
  return data.parts;
}

export type ProcedureManualPartCandidateDto = {
  partNumber: string;
  partNumberKey: string;
  partName: string | null;
  hasManual: boolean;
};

export async function listProcedureManualPartCandidates(params: { q?: string; digitQuery?: string; machineName?: string; limit?: number } = {}) {
  const qs = new URLSearchParams();
  if (params.q) qs.set('q', params.q);
  if (params.digitQuery) qs.set('digitQuery', params.digitQuery);
  if (params.machineName) qs.set('machineName', params.machineName);
  if (params.limit) qs.set('limit', String(params.limit));
  const suffix = qs.toString() ? `?${qs.toString()}` : '';
  const { data } = await api.get<{ parts: ProcedureManualPartCandidateDto[] }>(`/assembly/procedure-manuals/part-candidates${suffix}`);
  return data.parts;
}

function procedureManualPath(modelCodeKey: string, processId: string) {
  return `/assembly/procedure-manuals/models/${encodeURIComponent(modelCodeKey)}/processes/${encodeURIComponent(processId)}`;
}

export async function getProcedureManualAssignments(modelCodeKey: string, processId: string) {
  const { data } = await api.get<import('../../../features/assembly/types').ProcedureManualDetailDto>(procedureManualPath(modelCodeKey, processId));
  return data;
}

export async function replaceProcedureManualAssignments(modelCodeKey: string, processId: string, input: {
  modelCode: string;
  assignments: import('../../../features/assembly/types').ProcedureManualAssignmentInput[];
}) {
  await api.put(procedureManualPath(modelCodeKey, processId), input);
}

export async function getProcedureManualOverview(processId?: string, published?: boolean, subjectKind?: 'MODEL' | 'PART' | 'COMMON') {
  const { data } = await api.get<import('../../../features/assembly/types').ProcedureManualOverviewDto>(
    '/assembly/procedure-manuals/overview', { params: { processId, published, subjectKind } }
  );
  return data;
}

export async function getProcedureManualModelOverview(modelCodeKey: string) {
  const { data } = await api.get<import('../../../features/assembly/types').ProcedureManualModelOverviewDto>(
    `/assembly/procedure-manuals/models/${encodeURIComponent(modelCodeKey)}/overview`
  );
  // 配布途中の古い API は otherAssignments を返さない
  return {
    ...data,
    processes: data.processes.map(process => ({
      ...process,
      items: process.items.map(item => ({ ...item, otherAssignments: item.otherAssignments ?? [] }))
    }))
  };
}

export async function getProcedureManualsByPart(partNumber: string) {
  const { data } = await api.get<import('../../../features/assembly/types').ProcedureManualByPartDto>('/assembly/procedure-manuals/by-part', { params: { partNumber } });
  return data;
}

export async function listProcedureManualCommon(published = false) {
  const { data } = await api.get<import('../../../features/assembly/types').ProcedureManualCommonCatalogDto>('/assembly/procedure-manuals/common', { params: { published } });
  return data;
}

export async function createProcedureManualCommon(input: { categoryId: string; target: string; actionId: string; kanaRow?: string }) {
  const { data } = await api.post<{ id: string; modelCode: string; modelCodeKey: string; processId: string }>('/assembly/procedure-manuals/common', input);
  return data;
}

export async function saveProcedureManualCommonChoice(kind: 'categories' | 'actions', name: string, id?: string) {
  const path = `/assembly/procedure-manuals/common/${kind}${id ? `/${encodeURIComponent(id)}` : ''}`;
  if (id) await api.patch(path, { name }); else await api.post(path, { name });
}

export async function deleteProcedureManualCommonChoice(kind: 'categories' | 'actions', id: string) {
  await api.delete(`/assembly/procedure-manuals/common/${kind}/${encodeURIComponent(id)}`);
}
