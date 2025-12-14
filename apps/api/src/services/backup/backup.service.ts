import path from 'path';
import { promises as fs } from 'fs';
import type { BackupProvider } from './backup-provider.interface.js';
import type { BackupTarget } from './backup-target.interface.js';
import type {
  BackupOptions,
  BackupResult,
  BackupTargetInfo,
  ListBackupsOptions,
  RestoreOptions,
  RestoreResult
} from './backup-types.js';
import type { StorageProvider, FileInfo } from './storage/storage-provider.interface.js';

export class BackupService implements BackupProvider {
  constructor(private readonly storage: StorageProvider) {}

  async backup(target: BackupTarget, options?: BackupOptions): Promise<BackupResult> {
    const data = await target.createBackup();
    const key = this.buildPath(target.info, options);

    try {
      await this.storage.upload(data, key);
      return {
        target: target.info,
        success: true,
        path: key,
        sizeBytes: data.length,
        timestamp: new Date()
      };
    } catch (error) {
      return {
        target: target.info,
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
        timestamp: new Date()
      };
    }
  }

  async restore(backupId: string, options?: RestoreOptions): Promise<RestoreResult> {
    try {
      const data = await this.storage.download(backupId);

      if (options?.destination) {
        await fs.mkdir(path.dirname(options.destination), { recursive: true });
        await fs.writeFile(options.destination, data);
      }

      return {
        backupId,
        success: true,
        timestamp: new Date()
      };
    } catch (error) {
      return {
        backupId,
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
        timestamp: new Date()
      };
    }
  }

  async listBackups(options?: ListBackupsOptions): Promise<BackupResult[]> {
    const prefix = options?.prefix ?? 'backups';
    const entries = await this.storage.list(prefix);
    const now = new Date();

    return entries.map((entry: FileInfo) => ({
      target: { type: 'file', source: entry.path },
      success: true,
      path: entry.path,
      sizeBytes: entry.sizeBytes,
      timestamp: entry.modifiedAt ?? now,
      modifiedAt: entry.modifiedAt ?? now
    }));
  }

  async deleteBackup(backupId: string): Promise<void> {
    await this.storage.delete(backupId);
  }

  private buildPath(info: BackupTargetInfo, options?: BackupOptions): string {
    const now = new Date().toISOString().replace(/[:.]/g, '-');
    const label = options?.label ? `-${options.label}` : '';
    return `backups/${info.type}/${now}${label}/${info.source}`;
  }
}

