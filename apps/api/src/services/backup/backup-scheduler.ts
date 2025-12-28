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
    // Dropboxのアクセストークン更新時は設定ファイルへ書き戻す（次回以降の実行を安定化）
    const onTokenUpdate = async (newToken: string) => {
      config.storage.options = {
        ...(config.storage.options ?? {}),
        accessToken: newToken
      };
      await BackupConfigLoader.save(config);
    };

    // バックアップターゲットを作成（Factoryパターンを使用）
    const backupTarget = BackupTargetFactory.createFromConfig(config, target.kind, target.source, target.metadata);

    // ストレージプロバイダーのリストを決定（多重バックアップ対応）
    const providers: ('local' | 'dropbox')[] = [];
    if (target.storage?.providers && target.storage.providers.length > 0) {
      // providers配列が指定されている場合はそれを使用
      providers.push(...target.storage.providers);
    } else if (target.storage?.provider) {
      // providerが指定されている場合は単一プロバイダーとして扱う
      providers.push(target.storage.provider);
    } else {
      // 未指定の場合は全体設定を使用
      providers.push(config.storage.provider);
    }

    // 各プロバイダーに順次バックアップを実行（多重バックアップ）
    const results: Array<{ provider: 'local' | 'dropbox'; success: boolean; error?: string }> = [];
    for (const provider of providers) {
      try {
        // 一時的にtargetのstorage.providerを設定してストレージプロバイダーを作成
        const targetWithProvider = {
          ...target,
          storage: { provider }
        };
        const storageProvider = StorageProviderFactory.createFromTarget(config, targetWithProvider, undefined, undefined, onTokenUpdate);
        const backupService = new BackupService(storageProvider);

        // バックアップを実行
        const result = await backupService.backup(backupTarget, {
          label: target.metadata?.label as string
        });

        if (!result.success) {
          results.push({ provider, success: false, error: result.error });
        } else {
          results.push({ provider, success: true });
        }
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        results.push({ provider, success: false, error: errorMessage });
        // エラーが発生しても次のプロバイダーに続行
      }
    }

    // すべてのプロバイダーで失敗した場合はエラーをスロー
    const allFailed = results.every((r) => !r.success);
    if (allFailed) {
      const errorMessages = results.map((r) => `${r.provider}: ${r.error || 'Unknown error'}`).join('; ');
      throw new Error(`Backup failed on all providers: ${errorMessages}`);
    }

    // 成功したプロバイダーのストレージプロバイダーを使用してクリーンアップ
    const successfulProvider = providers.find((p, i) => results[i]?.success);
    if (successfulProvider) {
      // 対象ごとのretention設定を優先、未指定の場合は全体設定を使用（Phase 3）
      const retention = target.retention || config.retention;
      if (retention && retention.days) {
        const targetWithProvider = {
          ...target,
          storage: { provider: successfulProvider }
        };
        const storageProvider = StorageProviderFactory.createFromTarget(config, targetWithProvider, undefined, undefined, onTokenUpdate);
                const backupService = new BackupService(storageProvider);
                // 対象ごとのバックアップのみをクリーンアップするため、prefixを指定
                // DatabaseBackupTargetのinfo.sourceはデータベース名のみ（例: "borrow_return"）なので、
                // 完全なURLからデータベース名を抽出する必要がある
                let sourceForPrefix = target.source;
                if (target.kind === 'database') {
                  try {
                    const url = new URL(target.source);
                    sourceForPrefix = url.pathname.replace(/^\//, '') || 'database';
                  } catch {
                    // URL解析に失敗した場合はそのまま使用
                  }
                }
                const prefix = `${target.kind}/${sourceForPrefix}`;
                await this.cleanupOldBackups(backupService, retention, prefix);
      }
    }
  }

  /**
   * 古いバックアップを削除（Phase 3: 対象ごとのretention設定に対応）
   */
  private async cleanupOldBackups(
    backupService: BackupService,
    retention: { days?: number; maxBackups?: number } | undefined,
    prefix?: string // 対象ごとのバックアップをフィルタするためのプレフィックス
  ): Promise<void> {
    if (!retention || !retention.days) {
      return;
    }

    // 対象ごとのバックアップのみを取得（prefixが指定されている場合）
    const backups = await backupService.listBackups({ prefix });
    const now = new Date();
    const retentionDate = new Date(now.getTime() - retention.days * 24 * 60 * 60 * 1000);

    // 最大バックアップ数を超える場合は古いものから削除（保持期間に関係なく）
    if (retention.maxBackups && backups.length > retention.maxBackups) {
      // 全バックアップを日付順にソート（古い順）
      const allSortedBackups = backups.sort((a, b) => {
        if (!a.modifiedAt || !b.modifiedAt) return 0;
        return a.modifiedAt.getTime() - b.modifiedAt.getTime();
      });
      const toDelete = allSortedBackups.slice(0, backups.length - retention.maxBackups);
      for (const backup of toDelete) {
        if (!backup.path) continue;
        try {
          await backupService.deleteBackup(backup.path);
          logger?.info({ path: backup.path, prefix }, '[BackupScheduler] Old backup deleted');
        } catch (error) {
          logger?.error({ err: error, path: backup.path, prefix }, '[BackupScheduler] Failed to delete old backup');
        }
      }
    }

    // 保持期間を超えたバックアップを削除（maxBackupsチェック後も実行）
    const sortedBackups = backups
      .filter(b => b.modifiedAt && b.modifiedAt < retentionDate)
      .sort((a, b) => {
        if (!a.modifiedAt || !b.modifiedAt) return 0;
        return a.modifiedAt.getTime() - b.modifiedAt.getTime();
      });
    for (const backup of sortedBackups) {
      if (!backup.path) continue;
      try {
        await backupService.deleteBackup(backup.path);
        logger?.info({ path: backup.path, prefix }, '[BackupScheduler] Old backup deleted');
      } catch (error) {
        logger?.error({ err: error, path: backup.path, prefix }, '[BackupScheduler] Failed to delete old backup');
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
