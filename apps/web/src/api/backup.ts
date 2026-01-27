import { api } from './client';

// バックアップ履歴の型定義
export type BackupOperationType = 'BACKUP' | 'RESTORE';
export type BackupStatus = 'PENDING' | 'PROCESSING' | 'COMPLETED' | 'FAILED';
export type BackupFileStatus = 'EXISTS' | 'DELETED';

export interface BackupHistory {
  id: string;
  operationType: BackupOperationType;
  targetKind: string;
  targetSource: string;
  backupPath?: string | null;
  storageProvider: string;
  status: BackupStatus;
  fileStatus: BackupFileStatus; // ファイルの存在状態
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

// CSVインポートターゲットの型定義
export interface CsvImportTarget {
  type: 'employees' | 'items' | 'measuringInstruments' | 'riggingGears' | 'csvDashboards';
  source: string; // Dropbox用: パス、Gmail用: 件名パターン、CSVダッシュボード用: ダッシュボードID
}

export type CsvImportSubjectPatternType =
  | 'employees'
  | 'items'
  | 'measuringInstruments'
  | 'riggingGears'
  | 'csvDashboards';

export interface CsvImportSubjectPattern {
  id: string;
  importType: CsvImportSubjectPatternType;
  dashboardId?: string | null;
  pattern: string;
  priority: number;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

export type CsvImportConfigType = 'employees' | 'items' | 'measuringInstruments' | 'riggingGears';
export type CsvImportStrategy = 'UPSERT' | 'REPLACE';

export interface CsvImportColumnDefinition {
  internalName: string;
  displayName: string;
  csvHeaderCandidates: string[];
  dataType: 'string' | 'number' | 'date' | 'boolean';
  order: number;
  required?: boolean;
}

export interface CsvImportConfig {
  id: string;
  importType: CsvImportConfigType;
  enabled: boolean;
  allowedManualImport: boolean;
  allowedScheduledImport: boolean;
  importStrategy: CsvImportStrategy;
  columnDefinitions: CsvImportColumnDefinition[];
  createdAt: string;
  updatedAt: string;
}

// CSVインポートスケジュールの型定義
export interface CsvImportSchedule {
  id: string;
  name?: string;
  provider?: 'dropbox' | 'gmail'; // プロバイダーを選択可能に（オプション、デフォルト: storage.provider）
  // 新形式: targets配列
  targets?: CsvImportTarget[];
  // 旧形式: 後方互換のため残す
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
  retryConfig?: {
    maxRetries: number;
    retryInterval: number; // 秒
    exponentialBackoff: boolean;
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

export async function runCsvImportSchedule(id: string): Promise<{ message: string; summary?: unknown }> {
  const { data } = await api.post<{ message: string; summary?: unknown }>(`/imports/schedule/${id}/run`, {});
  return data;
}

export async function getCsvImportSubjectPatterns(importType?: CsvImportSubjectPatternType, dashboardId?: string) {
  const { data } = await api.get<{ patterns: CsvImportSubjectPattern[] }>('/csv-import-subject-patterns', {
    params: importType ? { importType, dashboardId } : dashboardId ? { dashboardId } : undefined
  });
  return data;
}

export async function createCsvImportSubjectPattern(payload: {
  importType: CsvImportSubjectPatternType;
  dashboardId?: string | null;
  pattern: string;
  priority?: number;
  enabled?: boolean;
}) {
  const { data } = await api.post<{ pattern: CsvImportSubjectPattern }>(
    '/csv-import-subject-patterns',
    payload
  );
  return data.pattern;
}

export async function updateCsvImportSubjectPattern(
  id: string,
  payload: Partial<Pick<CsvImportSubjectPattern, 'pattern' | 'priority' | 'enabled'>>
) {
  const { data } = await api.put<{ pattern: CsvImportSubjectPattern }>(
    `/csv-import-subject-patterns/${id}`,
    payload
  );
  return data.pattern;
}

export async function deleteCsvImportSubjectPattern(id: string) {
  const { data } = await api.delete<{ success: boolean }>(`/csv-import-subject-patterns/${id}`);
  return data;
}

export async function reorderCsvImportSubjectPatterns(payload: {
  importType: CsvImportSubjectPatternType;
  dashboardId?: string | null;
  orderedIds: string[];
}) {
  const { data } = await api.post<{ patterns: CsvImportSubjectPattern[] }>(
    '/csv-import-subject-patterns/reorder',
    payload
  );
  return data.patterns;
}

export async function getCsvImportConfigs() {
  const { data } = await api.get<{ configs: CsvImportConfig[] }>('/csv-import-configs');
  return data.configs;
}

export async function getCsvImportConfig(importType: CsvImportConfigType) {
  const { data } = await api.get<{ config: CsvImportConfig | null }>(`/csv-import-configs/${importType}`);
  return data.config;
}

export async function upsertCsvImportConfig(importType: CsvImportConfigType, payload: {
  enabled: boolean;
  allowedManualImport: boolean;
  allowedScheduledImport: boolean;
  importStrategy: CsvImportStrategy;
  columnDefinitions: CsvImportColumnDefinition[];
}) {
  const { data } = await api.put<{ config: CsvImportConfig }>(`/csv-import-configs/${importType}`, payload);
  return data.config;
}

// バックアップ設定の型定義
export interface BackupTarget {
  kind: 'database' | 'file' | 'directory' | 'csv' | 'image' | 'client-file' | 'client-directory';
  source: string;
  schedule?: string;
  enabled: boolean;
  storage?: {
    provider?: 'local' | 'dropbox' | 'gmail'; // 対象ごとのストレージプロバイダー（単一、後方互換性のため残す）
    providers?: ('local' | 'dropbox' | 'gmail')[]; // 対象ごとのストレージプロバイダー（複数、Phase 2）
  };
  retention?: {
    days?: number; // 保持日数（例: 30日）
    maxBackups?: number; // 最大保持数（例: 10件）
  }; // 対象ごとの保持期間設定（Phase 3）
  metadata?: Record<string, unknown>;
}

export interface BackupConfig {
  storage: {
    provider: 'local' | 'dropbox' | 'gmail';
    options?: {
      basePath?: string;
      // 新構造: provider別名前空間（推奨）
      dropbox?: {
        appKey?: string;
        appSecret?: string;
        accessToken?: string;
        refreshToken?: string;
      };
      gmail?: {
        clientId?: string;
        clientSecret?: string;
        redirectUri?: string;
        accessToken?: string;
        refreshToken?: string;
        subjectPattern?: string;
        fromEmail?: string;
      };
      // 旧構造: 後方互換のため残す（deprecated、読み取りのみ）
      accessToken?: string; // Dropbox用（deprecated: options.dropbox.accessToken を使用）
      refreshToken?: string; // Dropbox用（deprecated: options.dropbox.refreshToken を使用）
      appKey?: string; // Dropbox用（deprecated: options.dropbox.appKey を使用）
      appSecret?: string; // Dropbox用（deprecated: options.dropbox.appSecret を使用）
      clientId?: string; // Gmail用（deprecated: options.gmail.clientId を使用）
      clientSecret?: string; // Gmail用（deprecated: options.gmail.clientSecret を使用）
      redirectUri?: string; // Gmail用（deprecated: options.gmail.redirectUri を使用）
      subjectPattern?: string; // Gmail用（deprecated: options.gmail.subjectPattern を使用）
      fromEmail?: string; // Gmail用（deprecated: options.gmail.fromEmail を使用）
      gmailAccessToken?: string; // deprecated: options.gmail.accessToken を使用
      gmailRefreshToken?: string; // deprecated: options.gmail.refreshToken を使用
    };
  };
  targets: BackupTarget[];
  retention?: {
    days?: number;
    maxBackups?: number;
  };
  csvImports?: CsvImportSchedule[];
  csvImportSubjectPatterns?: {
    employees?: string[];
    items?: string[];
    measuringInstruments?: string[];
    riggingGears?: string[];
  };
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
  kind: 'database' | 'file' | 'directory' | 'csv' | 'image' | 'client-file' | 'client-directory';
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

// Dropbox purge API
export interface PurgeDropboxRequest {
  confirmText: string;
}

export interface PurgeDropboxResponse {
  success: boolean;
  deletedCount: number;
  failedCount: number;
  totalCount: number;
  errors?: string[];
}

export async function purgeDropboxBackups(request: PurgeDropboxRequest): Promise<PurgeDropboxResponse> {
  const { data } = await api.post<PurgeDropboxResponse>('/backup/dropbox/purge', request);
  return data;
}

export async function runBackup(request: RunBackupRequest): Promise<RunBackupResponse> {
  const { data } = await api.post<RunBackupResponse>('/backup', request);
  return data;
}

// Gmail設定の型定義
export interface GmailConfig {
  provider?: 'gmail';
  clientId?: string;
  clientSecret?: string; // マスクされた値（例: "***1234"）
  subjectPattern?: string;
  fromEmail?: string;
  redirectUri?: string;
  hasAccessToken?: boolean;
  hasRefreshToken?: boolean;
}

export interface GmailConfigUpdateRequest {
  clientId?: string;
  clientSecret?: string;
  subjectPattern?: string;
  fromEmail?: string;
  redirectUri?: string;
}

// Gmail設定API
export async function getGmailConfig(): Promise<GmailConfig> {
  const { data } = await api.get<GmailConfig>('/gmail/config');
  return data;
}

export async function updateGmailConfig(config: GmailConfigUpdateRequest): Promise<{ success: boolean; message: string }> {
  const { data } = await api.put<{ success: boolean; message: string }>('/gmail/config', config);
  return data;
}

export async function deleteGmailConfig(): Promise<{ success: boolean; message: string }> {
  const { data } = await api.delete<{ success: boolean; message: string }>('/gmail/config');
  return data;
}

// Gmail OAuth認証API
export interface GmailOAuthAuthorizeResponse {
  authorizationUrl: string;
  state: string;
}

export async function getGmailOAuthAuthorizeUrl(): Promise<GmailOAuthAuthorizeResponse> {
  const { data } = await api.get<GmailOAuthAuthorizeResponse>('/gmail/oauth/authorize');
  return data;
}

export interface GmailOAuthRefreshResponse {
  success: boolean;
  accessToken?: string;
  expiresIn?: number;
}

export async function refreshGmailToken(): Promise<GmailOAuthRefreshResponse> {
  const { data } = await api.post<GmailOAuthRefreshResponse>('/gmail/oauth/refresh', {});
  return data;
}

// バックアップ設定の健全性チェックAPI
export interface BackupConfigHealthIssue {
  type: 'collision' | 'drift' | 'missing';
  severity: 'warning' | 'error';
  message: string;
  details?: Record<string, unknown>;
}

export interface BackupConfigHealth {
  status: 'healthy' | 'warning' | 'error';
  issues: BackupConfigHealthIssue[];
}

export async function getBackupConfigHealth(): Promise<BackupConfigHealth> {
  const { data } = await api.get<BackupConfigHealth>('/backup/config/health');
  return data;
}
