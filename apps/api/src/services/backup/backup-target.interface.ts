import type { BackupKind, BackupTargetInfo, RestoreOptions, RestoreResult } from './backup-types.js';
import type { UploadSource } from './storage/storage-provider.interface.js';

export interface BackupTarget {
  info: BackupTargetInfo;
  /**
   * バックアップ対象のデータを生成する
   */
  createBackup(): Promise<Buffer>;
  /**
   * 大容量バックアップ向けのアップロードソースを返す（任意実装）
   */
  createUploadSource?(): Promise<UploadSource>;
  /**
   * バックアップデータをリストアする（オプショナル）
   * ターゲットがリストアをサポートする場合のみ実装する
   */
  restore?(backupData: Buffer, options?: RestoreOptions): Promise<RestoreResult>;
}

export interface BackupTargetFactory {
  /**
   * タイプとソースからバックアップターゲットを生成する
   */
  create(kind: BackupKind, source: string, metadata?: Record<string, unknown>): BackupTarget;
}

