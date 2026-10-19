import { api } from '../../http';

import type { AssemblyFormalIdentifierDto, AssemblyTraceabilityDetailDto, AssemblyTraceabilityWorkUnitDto, AssemblyWorkUnitInvalidationDto, AssemblyWorkUnitInvalidationInput } from '../../../features/assembly/types';

export async function invalidateAssemblyWorkUnit(
  workUnitId: string,
  payload: AssemblyWorkUnitInvalidationInput
) {
  const { data } = await api.post<{ invalidation: AssemblyWorkUnitInvalidationDto }>(
    `/assembly/work-units/${workUnitId}/invalidate`,
    payload
  );
  return data.invalidation;
}

export async function verifyKioskAssemblyTraceabilityAccessPassword(payload: { password: string }) {
  const { data } = await api.post<{ success: boolean }>('/kiosk/assembly/traceability/verify-access-password', payload);
  return data;
}

export async function listAssemblyTraceabilityWorkUnits(params?: {
  state?: 'all' | 'unassigned' | 'assigned';
  query?: string;
  limit?: number;
}) {
  const qs = new URLSearchParams({ scope: 'top_level' });
  if (params?.state) qs.set('state', params.state);
  if (params?.query) qs.set('query', params.query);
  if (params?.limit) qs.set('limit', String(params.limit));
  const { data } = await api.get<{
    workUnits: Array<AssemblyTraceabilityWorkUnitDto & { formalIdentifier: AssemblyFormalIdentifierDto | null }>;
  }>(`/assembly/traceability/work-units?${qs.toString()}`);
  return data.workUnits;
}

export async function resolveAssemblyTraceabilityWorkUnit(workId: string) {
  const { data } = await api.post<AssemblyTraceabilityDetailDto>('/assembly/traceability/work-units/resolve', { workId });
  return data;
}

export async function linkAssemblyWorkUnits(payload: { parentWorkId: string; childWorkId: string; accessPassword: string }) {
  const { data } = await api.post<{ link: { id: string } }>('/assembly/traceability/links', payload);
  return data.link;
}

export async function unlinkAssemblyWorkUnits(linkId: string, payload: { accessPassword: string; reason: string }) {
  const { data } = await api.post<{ link: { id: string } }>(`/assembly/traceability/links/${linkId}/unlink`, payload);
  return data.link;
}

export async function reassignAssemblyWorkUnit(linkId: string, payload: { parentWorkId: string; accessPassword: string; reason: string }) {
  const { data } = await api.post<{ link: { id: string; replacedLinkId: string } }>(
    `/assembly/traceability/links/${linkId}/reassign`,
    payload
  );
  return data.link;
}

export async function assignAssemblyFormalIdentifier(payload: { workId: string; formalId: string; accessPassword: string }) {
  const { data } = await api.post<{ formalIdentifier: { id: string; formalId: string } }>(
    '/assembly/traceability/formal-identifiers',
    payload
  );
  return data.formalIdentifier;
}

export async function correctAssemblyFormalIdentifier(
  assignmentId: string,
  payload: { formalId: string; accessPassword: string; reason: string }
) {
  const { data } = await api.post<{ formalIdentifier: { id: string; formalId: string; correctedAssignmentId: string } }>(
    `/assembly/traceability/formal-identifiers/${assignmentId}/correct`,
    payload
  );
  return data.formalIdentifier;
}
