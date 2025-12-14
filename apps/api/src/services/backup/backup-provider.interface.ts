import type {
  BackupOptions,
  BackupResult,
  ListBackupsOptions,
  RestoreOptions,
  RestoreResult
} from './backup-types.js';
import type { BackupTarget } from './backup-target.interface.js';

export interface BackupProvider {
  backup(target: BackupTarget, options?: BackupOptions): Promise<BackupResult>;
  restore(backupId: string, options?: RestoreOptions): Promise<RestoreResult>;
  listBackups(options?: ListBackupsOptions): Promise<BackupResult[]>;
  deleteBackup(backupId: string): Promise<void>;
}

