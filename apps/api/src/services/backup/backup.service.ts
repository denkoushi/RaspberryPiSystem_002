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

function stripControlChars(value: string): string {
  return Array.from(value)
    .filter((char) => {
      const code = char.charCodeAt(0);
      return code >= 0x20 && code !== 0x7f;
    })
    .join('');
}

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
    const safeLabel = options?.label ? this.sanitizePathSegment(options.label) : '';
    const label = safeLabel ? `-${safeLabel}` : '';
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

  /**
   * パス要素として安全な文字列に正規化する。
   *
   * 目的:
   * - label が `/` を含むとパス階層が増え、Dropboxで 409(path_lookup 等) になり得る
   * - 末尾空白や制御文字を排除し、意図しないパス生成を防ぐ
   */
  private sanitizePathSegment(input: string): string {
    const trimmed = input.trim();
    if (!trimmed) return '';

    // 制御文字を除去（念のため）
    let s = stripControlChars(trimmed);
    // パス区切りは破壊的なので '_' に置換
    s = s.replace(/[/\\]/g, '_');
    // 空白は '_' に寄せる（視認性と安全性のバランス）
    s = s.replace(/\s+/g, '_');
    // '_' の連続は1つに正規化
    s = s.replace(/_+/g, '_');
    // 過度に長いラベルは切り詰め（パス肥大化・UI崩れを防ぐ）
    if (s.length > 64) s = s.slice(0, 64);
    return s;
  }
}

