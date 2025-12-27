import { api } from './client';

// バックアップ履歴の型定義
export type BackupOperationType = 'BACKUP' | 'RESTORE';
export type BackupStatus = 'PENDING' | 'PROCESSING' | 'COMPLETED' | 'FAILED';

export interface BackupHistory {
  id: string;
  operationType: BackupOperationType;
  targetKind: string;
  targetSource: string;
  backupPath?: string | null;
  storageProvider: string;
  status: BackupStatus;
  sizeBytes?: number | null;
  hash?: string | null;
  summary?: Record<string, unknown> | null;
  errorMessage?: string | null;
  startedAt: string;
  completedAt?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface BackupHistoryListResponse {
  history: BackupHistory[];
  total: number;
  offset: number;
  limit: number;
}

export interface BackupHistoryFilters {
  operationType?: BackupOperationType;
  targetKind?: string;
  status?: BackupStatus;
  startDate?: string;
  endDate?: string;
  offset?: number;
  limit?: number;
}

// CSVインポートスケジュールの型定義
export interface CsvImportSchedule {
  id: string;
  name?: string;
  employeesPath?: string;
  itemsPath?: string;
  schedule: string;
  timezone?: string;
  enabled: boolean;
  replaceExisting: boolean;
  autoBackupAfterImport?: {
    enabled: boolean;
    targets: ('csv' | 'database' | 'all')[];
  };
}

export interface CsvImportScheduleListResponse {
  schedules: CsvImportSchedule[];
}

// バックアップ履歴API
export async function getBackupHistory(filters?: BackupHistoryFilters): Promise<BackupHistoryListResponse> {
  const params = new URLSearchParams();
  if (filters?.operationType) params.append('operationType', filters.operationType);
  if (filters?.targetKind) params.append('targetKind', filters.targetKind);
  if (filters?.status) params.append('status', filters.status);
  if (filters?.startDate) params.append('startDate', filters.startDate);
  if (filters?.endDate) params.append('endDate', filters.endDate);
  if (filters?.offset !== undefined) params.append('offset', filters.offset.toString());
  if (filters?.limit !== undefined) params.append('limit', filters.limit.toString());

  const { data } = await api.get<BackupHistoryListResponse>(`/backup/history?${params.toString()}`);
  return data;
}

export async function getBackupHistoryById(id: string): Promise<BackupHistory> {
  const { data } = await api.get<BackupHistory>(`/backup/history/${id}`);
  return data;
}

// DropboxからのリストアAPI
export interface RestoreFromDropboxRequest {
  backupPath: string;
  targetKind?: 'database' | 'csv';
  verifyIntegrity?: boolean;
  expectedSize?: number;
  expectedHash?: string;
}

export interface RestoreFromDropboxResponse {
  success: boolean;
  message: string;
  backupPath: string;
  timestamp: string;
  historyId: string;
}

export async function restoreFromDropbox(request: RestoreFromDropboxRequest): Promise<RestoreFromDropboxResponse> {
  const { data } = await api.post<RestoreFromDropboxResponse>('/backup/restore/from-dropbox', request);
  return data;
}

// CSVインポートスケジュールAPI
export async function getCsvImportSchedules(): Promise<CsvImportScheduleListResponse> {
  const { data } = await api.get<CsvImportScheduleListResponse>('/imports/schedule');
  return data;
}

export async function createCsvImportSchedule(schedule: Omit<CsvImportSchedule, 'id'> & { id: string }): Promise<{ schedule: CsvImportSchedule }> {
  const { data } = await api.post<{ schedule: CsvImportSchedule }>('/imports/schedule', schedule);
  return data;
}

export async function updateCsvImportSchedule(id: string, schedule: Partial<CsvImportSchedule>): Promise<{ schedule: CsvImportSchedule }> {
  const { data } = await api.put<{ schedule: CsvImportSchedule }>(`/imports/schedule/${id}`, schedule);
  return data;
}

export async function deleteCsvImportSchedule(id: string): Promise<{ message: string }> {
  const { data } = await api.delete<{ message: string }>(`/imports/schedule/${id}`);
  return data;
}

export async function runCsvImportSchedule(id: string): Promise<{ message: string }> {
  const { data } = await api.post<{ message: string }>(`/imports/schedule/${id}/run`, {});
  return data;
}

// バックアップ設定の型定義
export interface BackupTarget {
  kind: 'database' | 'file' | 'directory' | 'csv' | 'image';
  source: string;
  schedule?: string;
  enabled: boolean;
  metadata?: Record<string, unknown>;
}

export interface BackupConfig {
  storage: {
    provider: 'local' | 'dropbox';
    options?: {
      basePath?: string;
      accessToken?: string;
      refreshToken?: string;
      appKey?: string;
      appSecret?: string;
    };
  };
  targets: BackupTarget[];
  retention?: {
    days?: number;
    maxBackups?: number;
  };
  csvImports?: CsvImportSchedule[];
  csvImportHistory?: {
    retentionDays?: number;
    cleanupSchedule?: string;
  };
  restoreFromDropbox?: {
    enabled?: boolean;
    verifyIntegrity?: boolean;
    defaultTargetKind?: 'database' | 'csv';
  };
}

// バックアップ設定API
export async function getBackupConfig(): Promise<BackupConfig> {
  const { data } = await api.get<BackupConfig>('/backup/config');
  return data;
}

export async function updateBackupConfig(config: BackupConfig): Promise<{ success: boolean }> {
  const { data } = await api.put<{ success: boolean }>('/backup/config', config);
  return data;
}

// バックアップ対象操作API
export async function addBackupTarget(target: Omit<BackupTarget, 'enabled'> & { enabled?: boolean }): Promise<{ success: boolean; target: BackupTarget }> {
  const { data } = await api.post<{ success: boolean; target: BackupTarget }>('/backup/config/targets', target);
  return data;
}

export async function updateBackupTarget(index: number, target: Partial<BackupTarget>): Promise<{ success: boolean; target: BackupTarget }> {
  const { data } = await api.put<{ success: boolean; target: BackupTarget }>(`/backup/config/targets/${index}`, target);
  return data;
}

export async function deleteBackupTarget(index: number): Promise<{ success: boolean; target: BackupTarget }> {
  const { data } = await api.delete<{ success: boolean; target: BackupTarget }>(`/backup/config/targets/${index}`);
  return data;
}

// 手動バックアップ実行API
export interface RunBackupRequest {
  kind: 'database' | 'file' | 'directory' | 'csv' | 'image';
  source: string;
  metadata?: Record<string, unknown>;
}

export interface RunBackupResponse {
  success: boolean;
  path?: string;
  sizeBytes?: number;
  timestamp: string;
  historyId?: string;
}

export async function runBackup(request: RunBackupRequest): Promise<RunBackupResponse> {
  // #region agent log
  fetch('http://127.0.0.1:7242/ingest/efef6d23-e2ed-411f-be56-ab093f2725f8',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'backup.ts:209',message:'runBackup called',data:{kind:request.kind,source:request.source,hasMetadata:!!request.metadata},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'D'})}).catch(()=>{});
  // #endregion
  try {
    const { data } = await api.post<RunBackupResponse>('/backup', request);
    // #region agent log
    fetch('http://127.0.0.1:7242/ingest/efef6d23-e2ed-411f-be56-ab093f2725f8',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'backup.ts:212',message:'runBackup success',data:{success:data.success},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'D'})}).catch(()=>{});
    // #endregion
    return data;
  } catch (error: unknown) {
    // #region agent log
    const errorObj = error as { message?: string; response?: { status?: number; data?: unknown } };
    fetch('http://127.0.0.1:7242/ingest/efef6d23-e2ed-411f-be56-ab093f2725f8',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'backup.ts:217',message:'runBackup error',data:{errorMessage:errorObj?.message,statusCode:errorObj?.response?.status,responseData:errorObj?.response?.data},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'D'})}).catch(()=>{});
    // #endregion
    throw error;
  }
}
