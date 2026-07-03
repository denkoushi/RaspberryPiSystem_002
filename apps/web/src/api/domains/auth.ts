import { api } from '../http';

import type { AuthResponse, MfaInitiateResponse, MfaActivateResponse, RoleAuditLog } from '../types';
export async function loginRequest(body: {
  username: string;
  password: string;
  totpCode?: string;
  backupCode?: string;
  rememberMe?: boolean;
}) {
  const { data } = await api.post<AuthResponse>('/auth/login', body);
  return data;
}

export async function mfaInitiate(): Promise<MfaInitiateResponse> {
  const { data } = await api.post<MfaInitiateResponse>('/auth/mfa/initiate', {});
  return data;
}

export async function mfaActivate(body: { secret: string; code: string; backupCodes: string[] }): Promise<MfaActivateResponse> {
  const { data } = await api.post<MfaActivateResponse>('/auth/mfa/activate', body);
  return data;
}

export async function mfaDisable(body: { password: string }): Promise<{ success: boolean }> {
  const { data } = await api.post<{ success: boolean }>('/auth/mfa/disable', body);
  return data;
}

export async function updateUserRole(userId: string, role: 'ADMIN' | 'MANAGER' | 'VIEWER') {
  const { data } = await api.post<{ user: AuthResponse['user'] }>(`/auth/users/${userId}/role`, { role });
  return data.user;
}

export async function getRoleAuditLogs(limit = 100) {
  const { data } = await api.get<{ logs: RoleAuditLog[] }>('/auth/role-audit', { params: { limit } });
  return data.logs;
}
