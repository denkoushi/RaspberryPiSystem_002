import { api } from '../../http';

import type { AssemblyCheckRecordDto, AssemblyCheckSummaryDto, AssemblyProcedureSequenceDto, AssemblyLotCreateInput, AssemblyLotSummaryDto, AssemblyOperatorAccessInput, AssemblyTorqueRecordOutcome, AssemblyWorkSessionDto, AssemblyWorkSessionSummaryDto, AssemblyWorkSessionStartInput } from '../../../features/assembly/types';

export async function resolveAssemblyOperatorNfc(uid: string) {
  const { data } = await api.post<{ employeeId: string; displayName: string }>(
    '/assembly/operators/resolve-nfc',
    { uid }
  );
  return data;
}

export async function getAssemblyWorkSessionProcedureSequence(sessionId: string) {
  const { data } = await api.get<{ sequence: AssemblyProcedureSequenceDto }>(
    `/assembly/work-sessions/${sessionId}/procedure-sequence`
  );
  return data.sequence;
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

export async function startAssemblyLotSerial(
  lotId: string,
  lotSerialId: string,
  payload: AssemblyOperatorAccessInput
) {
  const { data } = await api.post<{ session: AssemblyWorkSessionDto }>(
    `/assembly/lots/${lotId}/serials/${lotSerialId}/start`,
    payload
  );
  return data.session;
}

export async function recordAssemblyOperatorAccess(
  sessionId: string,
  payload: AssemblyOperatorAccessInput
) {
  const { data } = await api.post<{ session: AssemblyWorkSessionDto }>(
    `/assembly/work-sessions/${sessionId}/operator-access`,
    payload
  );
  return data.session;
}

export async function listAssemblyWorkSessionSummaries(params?: {
  status?: 'in_progress' | 'completed' | 'cancelled' | 'all';
  productNo?: string;
  workId?: string;
  serialNo?: string;
  limit?: number;
}) {
  const qs = new URLSearchParams();
  if (params?.status) qs.set('status', params.status);
  if (params?.productNo) qs.set('productNo', params.productNo);
  if (params?.workId) qs.set('workId', params.workId);
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
