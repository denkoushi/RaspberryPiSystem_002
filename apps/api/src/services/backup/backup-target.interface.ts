import type { BackupKind, BackupTargetInfo } from './backup-types';

export interface BackupTarget {
  info: BackupTargetInfo;
  /**
   * バックアップ対象のデータを生成する
   */
  createBackup(): Promise<Buffer>;
}

export interface BackupTargetFactory {
  /**
   * タイプとソースからバックアップターゲットを生成する
   */
  create(kind: BackupKind, source: string, metadata?: Record<string, unknown>): BackupTarget;
}

