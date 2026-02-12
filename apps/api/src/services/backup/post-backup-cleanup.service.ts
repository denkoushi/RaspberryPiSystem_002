import { logger } from '../../lib/logger.js';
import { BackupHistoryService } from './backup-history.service.js';
import type { BackupConfig } from './backup-config.js';
import type { BackupKind } from './backup-types.js';
import type { BackupExecutionResult, BackupProvider } from './backup-execution.service.js';
import { BackupService } from './backup.service.js';
import { StorageProviderFactory } from './storage-provider-factory.js';

export async function cleanupBackupsAfterManualExecution(params: {
  config: BackupConfig;
  targetConfig?: BackupConfig['targets'][number];
  targetKind: BackupKind;
  targetSource: string;
  protocol: string;
  host: string;
  resolvedProviders: BackupProvider[];
  results: BackupExecutionResult[];
  onTokenUpdate: (newToken: string) => Promise<void>;
}): Promise<void> {
  const {
    config,
    targetConfig,
    targetKind,
    targetSource,
    protocol,
    host,
    resolvedProviders,
    results,
    onTokenUpdate,
  } = params;

  if (!targetConfig) return;
  const retention = targetConfig.retention || config.retention;
  if (!retention || (!retention.days && !retention.maxBackups)) return;

  const successfulProvider = resolvedProviders.find((p, i) => results[i]?.success);
  if (!successfulProvider) return;

  const targetWithProvider = {
    ...targetConfig,
    storage: { provider: successfulProvider },
  };
  const storageProvider = await StorageProviderFactory.createFromTarget(
    config,
    targetWithProvider,
    protocol,
    host,
    onTokenUpdate
  );
  const backupService = new BackupService(storageProvider);
  const historyService = new BackupHistoryService();

  // 対象ごとのバックアップのみをクリーンアップするため、プレフィックスとフィルタを指定
  // DatabaseBackupTargetのinfo.sourceはデータベース名のみ（例: "borrow_return"）
  // 実際のパスは database/<timestamp>/borrow_return となるため、
  // prefix は kind のみ（database）にして、ファイル名で対象を絞り込む
  let sourceForPrefix = targetSource;
  if (targetKind === 'database') {
    try {
      const url = new URL(targetSource);
      sourceForPrefix = url.pathname.replace(/^\//, '') || 'database';
    } catch {
      // URL解析に失敗した場合はそのまま使用
    }
  }
  const prefix = `${targetKind}`; // 例: "database"

  try {
    const backups = await backupService.listBackups({ prefix });
    const now = new Date();
    const retentionDate = retention.days
      ? new Date(now.getTime() - retention.days * 24 * 60 * 60 * 1000)
      : null;

    // ターゲットのソース名に一致するバックアップのみ対象とする（DB/CSVは拡張子まで含めて一致させる）
    const matchesSource = (p: string | null | undefined): boolean => {
      if (!sourceForPrefix) return true;
      if (!p) return false;
      if (targetKind === 'database') {
        return p.endsWith(`/${sourceForPrefix}.sql.gz`) || p.endsWith(`/${sourceForPrefix}.sql`);
      }
      if (targetKind === 'csv') {
        return p.endsWith(`/${sourceForPrefix}.csv`);
      }
      return p.endsWith(`/${sourceForPrefix}`);
    };
    const targetBackups = backups.filter((b) => matchesSource(b.path));

    // 最大バックアップ数を超える場合は古いものから削除（保持期間に関係なく）
    if (retention.maxBackups && targetBackups.length > retention.maxBackups) {
      const allSortedBackups = targetBackups.sort((a, b) => {
        if (!a.modifiedAt || !b.modifiedAt) return 0;
        return a.modifiedAt.getTime() - b.modifiedAt.getTime();
      });
      const toDelete = allSortedBackups.slice(0, targetBackups.length - retention.maxBackups);
      for (const backup of toDelete) {
        if (!backup.path) continue;
        try {
          await backupService.deleteBackup(backup.path);
          try {
            const updatedCount = await historyService.markHistoryAsDeletedByPath(backup.path);
            if (updatedCount > 0) {
              logger?.info({ path: backup.path, updatedCount }, '[BackupRoute] Backup history fileStatus updated to DELETED');
            }
          } catch (error) {
            logger?.error({ err: error, path: backup.path }, '[BackupRoute] Failed to update backup history fileStatus');
          }
          logger?.info({ path: backup.path, prefix }, '[BackupRoute] Old backup deleted');
        } catch (error) {
          logger?.error({ err: error, path: backup.path, prefix }, '[BackupRoute] Failed to delete old backup');
        }
      }
    }

    // 保持期間を超えたバックアップを削除（maxBackupsチェック後も実行）
    if (retentionDate) {
      const sortedBackups = targetBackups
        .filter((b) => b.modifiedAt && b.modifiedAt < retentionDate)
        .sort((a, b) => {
          if (!a.modifiedAt || !b.modifiedAt) return 0;
          return a.modifiedAt.getTime() - b.modifiedAt.getTime();
        });
      for (const backup of sortedBackups) {
        if (!backup.path) continue;
        try {
          await backupService.deleteBackup(backup.path);
          try {
            const updatedCount = await historyService.markHistoryAsDeletedByPath(backup.path);
            if (updatedCount > 0) {
              logger?.info({ path: backup.path, updatedCount }, '[BackupRoute] Backup history fileStatus updated to DELETED');
            }
          } catch (error) {
            logger?.error({ err: error, path: backup.path }, '[BackupRoute] Failed to update backup history fileStatus');
          }
          logger?.info({ path: backup.path, prefix }, '[BackupRoute] Old backup deleted');
        } catch (error) {
          logger?.error({ err: error, path: backup.path, prefix }, '[BackupRoute] Failed to delete old backup');
        }
      }
    }

    // バックアップ履歴も最大件数を超えた分のファイルステータスをDELETEDに更新
    if (retention.maxBackups) {
      try {
        const markedCount = await historyService.markExcessHistoryAsDeleted({
          targetKind,
          targetSource,
          maxCount: retention.maxBackups,
        });
        if (markedCount > 0) {
          logger?.info({ markedCount, targetKind, targetSource }, '[BackupRoute] Old backup history marked as DELETED');
        }
      } catch (error) {
        logger?.error({ err: error }, '[BackupRoute] Failed to mark old backup history as DELETED');
      }
    }
  } catch (error) {
    logger?.error({ err: error, prefix }, '[BackupRoute] Failed to cleanup old backups');
    // クリーンアップエラーはバックアップ成功を妨げない
  }
}
