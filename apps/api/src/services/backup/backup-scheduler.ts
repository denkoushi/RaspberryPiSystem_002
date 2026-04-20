import cron from 'node-cron';
import { BackupService } from './backup.service.js';
import { BackupConfigLoader } from './backup-config.loader.js';
import type { BackupConfig } from './backup-config.js';
import { BackupTargetFactory } from './backup-target-factory.js';
import { BackupHistoryService } from './backup-history.service.js';
import { logger } from '../../lib/logger.js';
import { writeDebugLog } from '../../lib/debug-log.js';
import { executeBackupAcrossProviders, resolveBackupProviders } from './backup-execution.service.js';
import { cleanupBackupsAfterManualExecution } from './post-backup-cleanup.service.js';

/**
 * バックアップスケジューラー
 */
export class BackupScheduler {
  private tasks: Map<string, cron.ScheduledTask> = new Map();
  private isRunning = false;

  /**
   * スケジューラーを開始
   */
  async start(): Promise<void> {
    if (this.isRunning) {
      logger?.warn('[BackupScheduler] Already running');
      return;
    }

    this.isRunning = true;
    const config = await BackupConfigLoader.load();
    
    // 各ターゲットのスケジュールを設定
    for (const target of config.targets) {
      if (!target.enabled || !target.schedule) {
        continue;
      }

      const taskId = `${target.kind}-${target.source}`;
      
      // 既存のタスクがあれば削除
      const existingTask = this.tasks.get(taskId);
      if (existingTask) {
        existingTask.stop();
      }

      // スケジュールのバリデーション
      try {
        // node-cronのvalidate関数を使用してスケジュールを検証
        if (!cron.validate(target.schedule)) {
          logger?.warn(
            { taskId, schedule: target.schedule, kind: target.kind, source: target.source },
            '[BackupScheduler] Invalid cron schedule, skipping task'
          );
          continue;
        }
      } catch (error) {
        logger?.error(
          { err: error, taskId, schedule: target.schedule, kind: target.kind, source: target.source },
          '[BackupScheduler] Failed to validate cron schedule, skipping task'
        );
        continue;
      }

      // 新しいタスクを作成
      try {
        const task = cron.schedule(target.schedule, async () => {
          try {
            logger?.info(
              { kind: target.kind, source: target.source },
              '[BackupScheduler] Starting scheduled backup'
            );

            await this.executeBackup(config, target);

            logger?.info(
              { kind: target.kind, source: target.source },
              '[BackupScheduler] Scheduled backup completed'
            );
          } catch (error) {
            logger?.error(
              { err: error, kind: target.kind, source: target.source },
              '[BackupScheduler] Scheduled backup failed'
            );
          }
        }, {
          scheduled: true,
          timezone: 'Asia/Tokyo'
        });

        this.tasks.set(taskId, task);
        logger?.info(
          { taskId, schedule: target.schedule },
          '[BackupScheduler] Scheduled task registered'
        );
      } catch (error) {
        logger?.error(
          { err: error, taskId, schedule: target.schedule, kind: target.kind, source: target.source },
          '[BackupScheduler] Failed to create scheduled task'
        );
        // エラーが発生しても処理を続行（他のタスクに影響しない）
      }
    }

    logger?.info(
      { taskCount: this.tasks.size },
      '[BackupScheduler] Scheduler started'
    );
  }

  /**
   * スケジューラーを停止
   */
  stop(): void {
    if (!this.isRunning) {
      return;
    }

    for (const [taskId, task] of this.tasks.entries()) {
      task.stop();
      logger?.info({ taskId }, '[BackupScheduler] Task stopped');
    }

    this.tasks.clear();
    this.isRunning = false;
    logger?.info('[BackupScheduler] Scheduler stopped');
  }

  /**
   * スケジュールを再読み込み
   */
  async reload(): Promise<void> {
    this.stop();
    await this.start();
  }

  /**
   * バックアップを実行
   */
  private async executeBackup(
    config: BackupConfig,
    target: BackupConfig['targets'][0]
  ): Promise<void> {
    // Dropboxのアクセストークン更新時は設定ファイルへ書き戻す（次回以降の実行を安定化）
    // Dropbox専用: options.dropbox.accessToken へ保存
    const onTokenUpdate = async (newToken: string) => {
      const latestConfig = await BackupConfigLoader.load();
      latestConfig.storage.options = {
        ...(latestConfig.storage.options ?? {}),
        dropbox: {
          ...latestConfig.storage.options?.dropbox,
          accessToken: newToken
        }
      };
      await BackupConfigLoader.save(latestConfig);
    };

    // バックアップターゲットを作成（Factoryパターンを使用）
    const backupTarget = BackupTargetFactory.createFromConfig(config, target.kind, target.source, target.metadata);

    const resolvedProviders = resolveBackupProviders({ config, targetConfig: target });
    const { results } = await executeBackupAcrossProviders({
      config,
      targetConfig: target,
      target: backupTarget,
      targetKind: target.kind,
      targetSource: target.source,
      protocol: 'http',
      host: 'localhost',
      onTokenUpdate,
      label: target.metadata?.label as string
    });

    const allFailed = results.every((r) => !r.success);
    if (allFailed) {
      const errorMessages = results.map((r) => `${r.provider}: ${r.error || 'Unknown error'}`).join('; ');
      throw new Error(`Backup failed on all providers: ${errorMessages}`);
    }

    await cleanupBackupsAfterManualExecution({
      config,
      targetConfig: target,
      targetKind: target.kind,
      targetSource: target.source,
      protocol: 'http',
      host: 'localhost',
      resolvedProviders,
      results,
      onTokenUpdate,
    });
  }

  /**
   * 古いバックアップを削除（Phase 3: 対象ごとのretention設定に対応）
   */
  private async cleanupOldBackups(
    backupService: BackupService,
    retention: { days?: number; maxBackups?: number } | undefined,
    prefix?: string, // 対象ごとのバックアップをフィルタするためのプレフィックス
    sourceForPrefix?: string, // パス末尾で対象を特定するためのソース名（例: borrow_return）
    targetKind?: string, // ターゲットの種類
    targetSource?: string // ターゲットのソース
  ): Promise<void> {
    if (!retention || (!retention.days && !retention.maxBackups)) {
      return;
    }

    // 対象ごとのバックアップのみを取得（prefixが指定されている場合）
    const backups = await backupService.listBackups({ prefix });
    // ターゲットのソース名に一致するバックアップのみ対象とする
    const matchesSource = (path: string | null | undefined): boolean => {
      if (!sourceForPrefix) return true;
      if (!path) return false;
      if (targetKind === 'database') {
        return path.endsWith(`/${sourceForPrefix}.sql.gz`) || path.endsWith(`/${sourceForPrefix}.sql`);
      }
      if (targetKind === 'csv') {
        return path.endsWith(`/${sourceForPrefix}.csv`);
      }
      return path.endsWith(`/${sourceForPrefix}`);
    };
    const targetBackups = backups.filter((b) => matchesSource(b.path));
    const retentionDate = retention.days
      ? new Date(Date.now() - retention.days * 24 * 60 * 60 * 1000)
      : null;

    const historyService = new BackupHistoryService();

    // 最大バックアップ数を超える場合は古いものから削除（保持期間に関係なく）
    if (retention.maxBackups && targetBackups.length > retention.maxBackups) {
      // 全バックアップを日付順にソート（古い順）
      const allSortedBackups = targetBackups.sort((a, b) => {
        if (!a.modifiedAt || !b.modifiedAt) return 0;
        return a.modifiedAt.getTime() - b.modifiedAt.getTime();
      });
      const toDelete = allSortedBackups.slice(0, targetBackups.length - retention.maxBackups);
      for (const backup of toDelete) {
        if (!backup.path) continue;
        try {
          await backupService.deleteBackup(backup.path);
          // ファイル削除後、対応する履歴レコードのfileStatusをDELETEDに更新
          try {
            const updatedCount = await historyService.markHistoryAsDeletedByPath(backup.path);
            if (updatedCount > 0) {
              logger?.info({ path: backup.path, updatedCount }, '[BackupScheduler] Backup history fileStatus updated to DELETED');
            }
          } catch (error) {
            logger?.error({ err: error, path: backup.path }, '[BackupScheduler] Failed to update backup history fileStatus');
          }
          logger?.info({ path: backup.path, prefix }, '[BackupScheduler] Old backup deleted');
        } catch (error) {
          logger?.error({ err: error, path: backup.path, prefix }, '[BackupScheduler] Failed to delete old backup');
        }
      }
    }

    // 保持期間を超えたバックアップを削除（maxBackupsチェック後も実行）
    if (retentionDate) {
      const sortedBackups = targetBackups
        .filter(b => b.modifiedAt && b.modifiedAt < retentionDate)
        .sort((a, b) => {
          if (!a.modifiedAt || !b.modifiedAt) return 0;
          return a.modifiedAt.getTime() - b.modifiedAt.getTime();
        });
      for (const backup of sortedBackups) {
        if (!backup.path) continue;
        try {
          await backupService.deleteBackup(backup.path);
          // ファイル削除後、対応する履歴レコードのfileStatusをDELETEDに更新
          try {
            const updatedCount = await historyService.markHistoryAsDeletedByPath(backup.path);
            if (updatedCount > 0) {
              logger?.info({ path: backup.path, updatedCount }, '[BackupScheduler] Backup history fileStatus updated to DELETED');
            }
          } catch (error) {
            logger?.error({ err: error, path: backup.path }, '[BackupScheduler] Failed to update backup history fileStatus');
          }
          logger?.info({ path: backup.path, prefix }, '[BackupScheduler] Old backup deleted');
        } catch (error) {
          logger?.error({ err: error, path: backup.path, prefix }, '[BackupScheduler] Failed to delete old backup');
        }
      }
    }

    // バックアップ履歴も最大件数を超えた分のファイルステータスをDELETEDに更新
    if (retention.maxBackups && targetKind && targetSource) {
      try {
        const markedCount = await historyService.markExcessHistoryAsDeleted({
          targetKind,
          targetSource,
          maxCount: retention.maxBackups
        });
        if (markedCount > 0) {
          logger?.info({ markedCount, targetKind, targetSource }, '[BackupScheduler] Old backup history marked as DELETED');
        }
      } catch (error) {
        logger?.error({ err: error }, '[BackupScheduler] Failed to mark old backup history as DELETED');
      }
    }
  }
}

// シングルトンインスタンス
let schedulerInstance: BackupScheduler | null = null;

/**
 * バックアップスケジューラーのインスタンスを取得
 */
export function getBackupScheduler(): BackupScheduler {
  if (!schedulerInstance) {
    schedulerInstance = new BackupScheduler();
  }
  return schedulerInstance;
}
