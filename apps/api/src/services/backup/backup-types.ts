export type BackupKind = 'database' | 'file' | 'directory' | 'csv' | 'image';

export interface BackupTargetInfo {
  type: BackupKind;
  source: string;
  metadata?: Record<string, unknown>;
}

export interface BackupResult {
  target: BackupTargetInfo;
  success: boolean;
  path?: string;
  sizeBytes?: number;
  error?: string;
  timestamp: Date;
  modifiedAt?: Date;
}

export interface RestoreResult {
  backupId: string;
  success: boolean;
  error?: string;
  timestamp: Date;
}

export interface BackupOptions {
  label?: string;
  retentionDays?: number;
}

export interface RestoreOptions {
  destination?: string;
  overwrite?: boolean;
}

export interface ListBackupsOptions {
  prefix?: string;
  limit?: number;
}

