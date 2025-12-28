import cron from 'node-cron';
import { BackupService } from './backup.service.js';
import { BackupConfigLoader } from './backup-config.loader.js';
import type { BackupConfig } from './backup-config.js';
import { BackupTargetFactory } from './backup-target-factory.js';
import { StorageProviderFactory } from './storage-provider-factory.js';
import { logger } from '../../lib/logger.js';

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
    // ストレージプロバイダーを作成（Factoryパターンを使用）
    // 対象ごとのストレージプロバイダーが指定されている場合はそれを使用、未指定の場合は全体設定を使用
    // Dropboxのアクセストークン更新時は設定ファイルへ書き戻す（次回以降の実行を安定化）
    const onTokenUpdate = async (newToken: string) => {
      config.storage.options = {
        ...(config.storage.options ?? {}),
        accessToken: newToken
      };
      await BackupConfigLoader.save(config);
    };
    const storageProvider = StorageProviderFactory.createFromTarget(config, target, undefined, undefined, onTokenUpdate);

    const backupService = new BackupService(storageProvider);

    // バックアップターゲットを作成（Factoryパターンを使用）
    const backupTarget = BackupTargetFactory.createFromConfig(config, target.kind, target.source, target.metadata);

    // バックアップを実行
    const result = await backupService.backup(backupTarget, {
      label: target.metadata?.label as string
    });

    if (!result.success) {
      throw new Error(`Backup failed: ${result.error}`);
    }

    // 保持期間を超えたバックアップを削除
    if (config.retention) {
      await this.cleanupOldBackups(backupService, config.retention);
    }
  }

  /**
   * 古いバックアップを削除
   */
  private async cleanupOldBackups(
    backupService: BackupService,
    retention: BackupConfig['retention']
  ): Promise<void> {
    if (!retention) {
      return;
    }

    const backups = await backupService.listBackups({});
    const now = new Date();
    const retentionDate = new Date(now.getTime() - retention.days * 24 * 60 * 60 * 1000);

    // 日付でソート（古い順）
    const sortedBackups = backups
      .filter(b => b.modifiedAt && b.modifiedAt < retentionDate)
      .sort((a, b) => {
        if (!a.modifiedAt || !b.modifiedAt) return 0;
        return a.modifiedAt.getTime() - b.modifiedAt.getTime();
      });

    // 最大バックアップ数を超える場合は古いものから削除
    if (retention.maxBackups && backups.length > retention.maxBackups) {
      const toDelete = sortedBackups.slice(0, backups.length - retention.maxBackups);
      for (const backup of toDelete) {
        if (!backup.path) continue;
        try {
          await backupService.deleteBackup(backup.path);
          logger?.info({ path: backup.path }, '[BackupScheduler] Old backup deleted');
        } catch (error) {
          logger?.error({ err: error, path: backup.path }, '[BackupScheduler] Failed to delete old backup');
        }
      }
    } else {
      // 保持期間を超えたバックアップを削除
      for (const backup of sortedBackups) {
        if (!backup.path) continue;
        try {
          await backupService.deleteBackup(backup.path);
          logger?.info({ path: backup.path }, '[BackupScheduler] Old backup deleted');
        } catch (error) {
          logger?.error({ err: error, path: backup.path }, '[BackupScheduler] Failed to delete old backup');
        }
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
