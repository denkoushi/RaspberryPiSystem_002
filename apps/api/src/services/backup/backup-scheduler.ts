import cron from 'node-cron';
import { BackupService } from './backup.service.js';
import { BackupConfigLoader } from './backup-config.loader.js';
import type { BackupConfig } from './backup-config.js';
import { BackupTargetFactory } from './backup-target-factory.js';
import { StorageProviderFactory } from './storage-provider-factory.js';
import { BackupHistoryService } from './backup-history.service.js';
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
    // #region agent log
    fetch('http://127.0.0.1:7242/ingest/efef6d23-e2ed-411f-be56-ab093f2725f8',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({sessionId:'debug-session',runId:'pre',hypothesisId:'C',location:'backup-scheduler.ts:start',message:'backup scheduler start',data:{targetsTotal:Array.isArray(config.targets)?config.targets.length:0,targetsWithSchedule:Array.isArray(config.targets)?config.targets.filter((target)=>target.enabled && !!target.schedule).length:0,csvImportsLen:Array.isArray(config.csvImports)?config.csvImports.length:0},timestamp:Date.now()})}).catch(()=>{});
    // #endregion
    
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

    // ストレージプロバイダーのリストを決定（多重バックアップ対応）
    // Gmailはバックアップ用ではないため、local/dropboxのみをサポート
    const providers: ('local' | 'dropbox')[] = [];
    if (target.storage?.providers && target.storage.providers.length > 0) {
      // providers配列が指定されている場合はそれを使用
      providers.push(...target.storage.providers.filter((p): p is 'local' | 'dropbox' => p === 'local' || p === 'dropbox'));
    } else if (target.storage?.provider && (target.storage.provider === 'local' || target.storage.provider === 'dropbox')) {
      // providerが指定されている場合は単一プロバイダーとして扱う
      providers.push(target.storage.provider);
    } else if (config.storage.provider === 'local' || config.storage.provider === 'dropbox') {
      // 未指定の場合は全体設定を使用
      providers.push(config.storage.provider);
    } else {
      // Gmailの場合はlocalにフォールバック
      providers.push('local');
    }

    // 各プロバイダーに順次バックアップを実行（多重バックアップ）
    const results: Array<{ provider: 'local' | 'dropbox'; success: boolean; error?: string }> = [];
    for (const requestedProvider of providers) {
      try {
        // 一時的にtargetのstorage.providerを設定してストレージプロバイダーを作成
        const targetWithProvider = {
          ...target,
          storage: { provider: requestedProvider }
        };
        const providerResult = await StorageProviderFactory.createFromTarget(config, targetWithProvider, undefined, undefined, onTokenUpdate, true);
        const actualProvider = providerResult.provider; // 実際に使用されたプロバイダー（フォールバック後の値）
        const storageProvider = providerResult.storageProvider;
        const backupService = new BackupService(storageProvider);

        // バックアップを実行
        const result = await backupService.backup(backupTarget, {
          label: target.metadata?.label as string
        });

        // Gmailの場合はlocalにフォールバック
        const safeProvider: 'local' | 'dropbox' = (actualProvider === 'local' || actualProvider === 'dropbox') ? actualProvider : 'local';
        if (!result.success) {
          results.push({ provider: safeProvider, success: false, error: result.error });
        } else {
          results.push({ provider: safeProvider, success: true });
        }
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        results.push({ provider: requestedProvider, success: false, error: errorMessage });
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
        const storageProvider = await StorageProviderFactory.createFromTarget(config, targetWithProvider, undefined, undefined, onTokenUpdate);
                const backupService = new BackupService(storageProvider);
                // 対象ごとのバックアップのみをクリーンアップするため、prefix+フィルタを指定
                // DatabaseBackupTargetのinfo.sourceはデータベース名のみ（例: "borrow_return"）
                // 実際のパスは database/<timestamp>/borrow_return となるため、prefix は kind のみとし、
                // cleanupOldBackups 内でファイル名フィルタを行う
                let sourceForPrefix = target.source;
                if (target.kind === 'database') {
                  try {
                    const url = new URL(target.source);
                    sourceForPrefix = url.pathname.replace(/^\//, '') || 'database';
                  } catch {
                    // URL解析に失敗した場合はそのまま使用
                  }
                }
                const prefix = `${target.kind}`; // 例: "database"
                await this.cleanupOldBackups(backupService, retention, prefix, sourceForPrefix, target.kind, target.source);
      }
    }
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
    if (!retention || !retention.days) {
      return;
    }

    // 対象ごとのバックアップのみを取得（prefixが指定されている場合）
    const backups = await backupService.listBackups({ prefix });
    // ターゲットのソース名に一致するバックアップのみ対象とする
    const targetBackups = sourceForPrefix
      ? backups.filter((b) => b.path?.endsWith(`/${sourceForPrefix}`))
      : backups;
    const now = new Date();
    const retentionDate = new Date(now.getTime() - retention.days * 24 * 60 * 60 * 1000);

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
