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
    // #region agent log
    fetch('http://127.0.0.1:7242/ingest/efef6d23-e2ed-411f-be56-ab093f2725f8',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'backup.service.ts:18',message:'BackupService.backup start',data:{targetType:target.info.type,targetSource:target.info.source},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'D'})}).catch(()=>{});
    // #endregion
    let data: Buffer;
    try {
      data = await target.createBackup();
      // #region agent log
      fetch('http://127.0.0.1:7242/ingest/efef6d23-e2ed-411f-be56-ab093f2725f8',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'backup.service.ts:22',message:'Backup data created',data:{dataSize:data.length},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'D'})}).catch(()=>{});
      // #endregion
    } catch (error) {
      // #region agent log
      fetch('http://127.0.0.1:7242/ingest/efef6d23-e2ed-411f-be56-ab093f2725f8',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'backup.service.ts:25',message:'Backup data creation failed',data:{error:error instanceof Error?error.message:'Unknown',errorName:error instanceof Error?error.name:'Unknown'},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'D'})}).catch(()=>{});
      // #endregion
      throw error;
    }
    const key = this.buildPath(target.info, options);
    // #region agent log
    fetch('http://127.0.0.1:7242/ingest/efef6d23-e2ed-411f-be56-ab093f2725f8',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'backup.service.ts:29',message:'Uploading backup',data:{key,dataSize:data.length},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'D'})}).catch(()=>{});
    // #endregion

    try {
      await this.storage.upload(data, key);
      // #region agent log
      fetch('http://127.0.0.1:7242/ingest/efef6d23-e2ed-411f-be56-ab093f2725f8',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'backup.service.ts:33',message:'Backup upload success',data:{key,sizeBytes:data.length},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'D'})}).catch(()=>{});
      // #endregion
      return {
        target: target.info,
        success: true,
        path: key,
        sizeBytes: data.length,
        timestamp: new Date()
      };
    } catch (error) {
      // #region agent log
      fetch('http://127.0.0.1:7242/ingest/efef6d23-e2ed-411f-be56-ab093f2725f8',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'backup.service.ts:42',message:'Backup upload error',data:{error:error instanceof Error?error.message:'Unknown',errorName:error instanceof Error?error.name:'Unknown',key},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'D'})}).catch(()=>{});
      // #endregion
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
    // LocalStorageProviderのgetBaseDir()が既に/opt/RaspberryPiSystem_002/backupsを返すため、
    // プレフィックスは空文字列または相対パスのみ
    const prefix = options?.prefix ?? '';
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
    // LocalStorageProviderのgetBaseDir()が既に/opt/RaspberryPiSystem_002/backupsを返すため、
    // ここでは相対パスのみを返す（backups/プレフィックスなし）
    // CSVファイルには.csv拡張子、データベースバックアップには.sql.gz拡張子を付与
    let extension = '';
    if (info.type === 'csv') {
      extension = '.csv';
    } else if (info.type === 'database') {
      extension = '.sql.gz';
    }
    return `${info.type}/${now}${label}/${info.source}${extension}`;
  }
}

