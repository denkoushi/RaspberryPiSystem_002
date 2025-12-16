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
