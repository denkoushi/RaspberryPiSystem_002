import { api } from '../http';

import type { ImportSummary } from '../types';
export interface ClientDevice {
  id: string;
  name: string;
  location?: string | null;
  apiKey: string;
  defaultMode?: 'PHOTO' | 'TAG' | null;
  /** Zero2W / haizen-agent 配膳エッジとしてキオスク設定対象に含める */
  haizenEdgeEnabled?: boolean;
  /** キオスク棚レイアウト編集を許可 */
  shelfLayoutEditEnabled?: boolean;
  /** キオスクのサイネージプレビュー参照先（API が返す場合のみ） */
  signagePreviewTargetApiKey?: string | null;
  lastSeenAt?: string | null;
  createdAt: string;
  updatedAt: string;
}

export async function getClients() {
  const { data } = await api.get<{ clients: ClientDevice[] }>('/clients');
  return data.clients;
}

export async function updateClient(
  id: string,
  payload: {
    name?: string;
    defaultMode?: 'PHOTO' | 'TAG' | null;
    haizenEdgeEnabled?: boolean;
    shelfLayoutEditEnabled?: boolean;
  }
) {
  const { data } = await api.put<{ client: ClientDevice }>(`/clients/${id}`, payload);
  return data.client;
}

export type ClientLogLevel = 'DEBUG' | 'INFO' | 'WARN' | 'ERROR';

export interface ClientLogEntry {
  id?: string;
  clientId: string;
  level: ClientLogLevel;
  message: string;
  context?: Record<string, unknown> | null;
  createdAt: string;
}

export interface ClientStatusEntry {
  clientId: string;
  hostname: string;
  ipAddress: string;
  cpuUsage: number;
  memoryUsage: number;
  diskUsage: number;
  temperature?: number | null;
  uptimeSeconds?: number | null;
  lastBoot?: string | null;
  lastSeen: string;
  stale: boolean;
  latestLogs: Array<Pick<ClientLogEntry, 'level' | 'message' | 'createdAt'>>;
}

export async function getClientStatuses() {
  const { data } = await api.get<{ requestId: string; clients: ClientStatusEntry[] }>('/clients/status');
  return data.clients;
}

export interface KioskCallTarget {
  clientId: string;
  hostname: string;
  ipAddress: string;
  lastSeen: string;
  stale: boolean;
  name: string;
  location: string | null;
}

export async function getKioskCallTargets() {
  const { data } = await api.get<{ selfClientId: string | null; targets: KioskCallTarget[] }>('/kiosk/call/targets');
  return data;
}

export async function getClientLogs(filters?: {
  clientId?: string;
  level?: ClientLogLevel;
  limit?: number;
  since?: string;
}) {
  const { data } = await api.get<{ requestId: string; logs: ClientLogEntry[] }>('/clients/logs', {
    params: {
      clientId: filters?.clientId,
      level: filters?.level,
      limit: filters?.limit,
      since: filters?.since
    }
  });
  return data.logs;
}

// クライアントログを送信（デバッグ用）
export async function postClientLogs(
  payload: { clientId: string; logs: Array<{ level: ClientLogLevel; message: string; context?: Record<string, unknown> | null }> },
  clientKey?: string
) {
  const { data } = await api.post<{ requestId: string; logsStored: number }>('/clients/logs', payload, {
    headers: clientKey ? { 'x-client-key': clientKey } : undefined
  });
  return data;
}

export interface FileAlert {
  id: string;
  type: string;
  message: string;
  details?: string;
  timestamp: string;
  acknowledged: boolean;
}

export interface DbAlert {
  id: string;
  type?: string;
  message?: string;
  timestamp: string;
  acknowledged: boolean;
  severity?: string;
}

export interface ClientAlerts {
  alerts: {
    staleClients: number;
    errorLogs: number;
    fileAlerts: number; // deprecated: 互換性のため残す（常に0）
    dbAlerts: number;
    hasAlerts: boolean;
  };
  details: {
    staleClientIds: string[];
    recentErrors: Array<{
      clientId: string;
      message: string;
      createdAt: string;
    }>;
    fileAlerts: FileAlert[]; // deprecated: 互換性のため残す（常に空配列）
    dbAlerts: DbAlert[];
  };
}

export async function getClientAlerts() {
  const { data } = await api.get<{ requestId: string } & ClientAlerts>('/clients/alerts');
  return data;
}

export async function acknowledgeAlert(alertId: string) {
  const { data } = await api.post<{ requestId: string; acknowledged: boolean }>(
    `/clients/alerts/${alertId}/acknowledge`
  );
  return data;
}

interface ImportMasterPayload {
  employeesFile?: File | null;
  itemsFile?: File | null;
  replaceExisting?: boolean;
}

export async function importMaster(payload: ImportMasterPayload) {
  const formData = new FormData();
  if (payload.employeesFile) {
    formData.append('employees', payload.employeesFile);
  }
  if (payload.itemsFile) {
    formData.append('items', payload.itemsFile);
  }
  formData.append('replaceExisting', String(payload.replaceExisting ?? false));

  const { data } = await api.post<{ summary: ImportSummary }>('/imports/master', formData, {
    headers: { 'Content-Type': 'multipart/form-data' }
  });
  return data;
}

interface ImportMasterSinglePayload {
  type: 'employees' | 'items' | 'measuringInstruments' | 'riggingGears' | 'machines';
  file: File;
  replaceExisting?: boolean;
}

export async function importMasterSingle(payload: ImportMasterSinglePayload) {
  const formData = new FormData();
  formData.append('file', payload.file);
  formData.append('replaceExisting', String(payload.replaceExisting ?? false));

  // キャメルケースをケバブケースに変換
  const typeMap: Record<string, string> = {
    'employees': 'employees',
    'items': 'items',
    'measuringInstruments': 'measuring-instruments',
    'riggingGears': 'rigging-gears',
    'machines': 'machines'
  };
  const urlType = typeMap[payload.type] || payload.type;

  const { data } = await api.post<{ summary: Record<string, ImportSummary> }>(`/imports/master/${urlType}`, formData, {
    headers: { 'Content-Type': 'multipart/form-data' }
  });
  return data;
}
