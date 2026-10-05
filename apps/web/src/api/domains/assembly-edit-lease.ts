import { isAxiosError } from 'axios';

import { api, apiBase, getResolvedClientKey } from '../http';

export type AssemblyProcedureDocumentEditLease = {
  holderLabel: string;
  acquiredAt: string;
  heartbeatAt: string;
  expiresAt?: string;
};

export async function acquireAssemblyProcedureDocumentEditLease(id: string, takeover = false, holderToken: string | null = null) {
  const response = await api.post<{ lease: AssemblyProcedureDocumentEditLease; mine: boolean; holderToken: string }>(
    `/assembly/procedure-documents/${encodeURIComponent(id)}/edit-lease`,
    { takeover },
    { headers: holderToken ? { 'x-procedure-edit-token': holderToken } : {} }
  );
  return response.data;
}

export function readAssemblyProcedureDocumentEditLock(error: unknown): AssemblyProcedureDocumentEditLease | null {
  if (!isAxiosError(error) || error.response?.status !== 409) return null;
  const data = error.response.data as { code?: string; errorCode?: string; lease?: AssemblyProcedureDocumentEditLease; details?: { lease?: AssemblyProcedureDocumentEditLease } } | undefined;
  return (data?.code ?? data?.errorCode) === 'ASSEMBLY_PROCEDURE_EDIT_LOCKED' ? data?.lease ?? data?.details?.lease ?? null : null;
}

export function releaseAssemblyProcedureDocumentEditLease(id: string, holderToken: string | null) {
  const authorization = api.defaults.headers.common.Authorization;
  return fetch(`${apiBase.replace(/\/$/, '')}/assembly/procedure-documents/${encodeURIComponent(id)}/edit-lease`, {
    method: 'DELETE',
    keepalive: true,
    headers: {
      'x-client-key': getResolvedClientKey(),
      ...(holderToken ? { 'x-procedure-edit-token': holderToken } : {}),
      ...(typeof authorization === 'string' ? { Authorization: authorization } : {})
    }
  });
}
