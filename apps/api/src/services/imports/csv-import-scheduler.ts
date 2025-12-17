import cron, { validate } from 'node-cron';
import { BackupConfigLoader } from '../backup/backup-config.loader.js';
import type { BackupConfig } from '../backup/backup-config.js';
import { DropboxStorageProvider } from '../backup/storage/dropbox-storage.provider.js';
import { DropboxOAuthService } from '../backup/dropbox-oauth.service.js';
import { LocalStorageProvider } from '../backup/storage/local-storage.provider.js';
import { BackupService } from '../backup/backup.service.js';
import { CsvBackupTarget } from '../backup/targets/csv-backup.target.js';
import { DatabaseBackupTarget } from '../backup/targets/database-backup.target.js';
import { BackupHistoryService } from '../backup/backup-history.service.js';
import { BackupVerifier } from '../backup/backup-verifier.js';
import { BackupOperationType } from '@prisma/client';
import { logger } from '../../lib/logger.js';
import { processCsvImport } from '../../routes/imports.js';
import { ImportHistoryService } from './import-history.service.js';
import { ImportAlertService } from './import-alert.service.js';

/**
 * CSVインポートスケジューラー
 */
export class CsvImportScheduler {
  private tasks: Map<string, cron.ScheduledTask> = new Map();
  private cleanupTask: cron.ScheduledTask | null = null;
  private isRunning = false;
  private runningImports: Set<string> = new Set(); // 実行中のインポートID
  private historyService: ImportHistoryService;
  private alertService: ImportAlertService;
  private backupHistoryService: BackupHistoryService;
  private consecutiveFailures: Map<string, number> = new Map(); // スケジュールID -> 連続失敗回数

  constructor() {
    this.historyService = new ImportHistoryService();
    this.alertService = new ImportAlertService();
    this.backupHistoryService = new BackupHistoryService();
  }

  /**
   * スケジューラーを開始
   */
  async start(): Promise<void> {
    if (this.isRunning) {
      logger?.warn('[CsvImportScheduler] Already running');
      return;
    }

    this.isRunning = true;
    const config = await BackupConfigLoader.load();
    
    // csvImportsが設定されていない場合でもクリーンアップJobは開始する
    if (!config.csvImports || config.csvImports.length === 0) {
      logger?.info('[CsvImportScheduler] No CSV import schedules configured');
      // クリーンアップJobのみ開始
      await this.startCleanupJob(config);
      return;
    }

    // 各CSVインポートスケジュールを設定
    for (const importSchedule of config.csvImports) {
      if (!importSchedule.enabled || !importSchedule.schedule) {
        continue;
      }

      const taskId = importSchedule.id;
      
      // 既存のタスクがあれば削除
      const existingTask = this.tasks.get(taskId);
      if (existingTask) {
        existingTask.stop();
      }

      // cron形式のバリデーション（無効な形式の場合はスキップ）
      try {
        // node-cronのバリデーションを試行
        if (!validate(importSchedule.schedule)) {
          logger?.warn(
            { taskId, name: importSchedule.name, schedule: importSchedule.schedule },
            '[CsvImportScheduler] Invalid cron schedule format, skipping'
          );
          continue;
        }
      } catch (error) {
        logger?.warn(
          { err: error, taskId, name: importSchedule.name, schedule: importSchedule.schedule },
          '[CsvImportScheduler] Invalid cron schedule format, skipping'
        );
        continue;
      }

      // 新しいタスクを作成
      const task = cron.schedule(importSchedule.schedule, async () => {
        // 既に実行中の場合はスキップ（重複実行防止）
        if (this.runningImports.has(taskId)) {
          logger?.warn(
            { taskId, name: importSchedule.name },
            '[CsvImportScheduler] Import already running, skipping'
          );
          return;
        }

        this.runningImports.add(taskId);
        let historyId: string | undefined;
        try {
          logger?.info(
            { taskId, name: importSchedule.name },
            '[CsvImportScheduler] Starting scheduled CSV import'
          );

          // インポート履歴を作成
          historyId = await this.historyService.createHistory({
            scheduleId: taskId,
            scheduleName: importSchedule.name,
            employeesPath: importSchedule.employeesPath,
            itemsPath: importSchedule.itemsPath
          });

          const summary = await this.executeImport(config, importSchedule);

          // インポート履歴を完了として更新
          if (historyId) {
            await this.historyService.completeHistory(historyId, summary);
          }

          logger?.info(
            { taskId, name: importSchedule.name },
            '[CsvImportScheduler] Scheduled CSV import completed'
          );

          // 自動バックアップが有効な場合、バックアップを実行
          if (importSchedule.autoBackupAfterImport?.enabled) {
            try {
              await this.executeAutoBackup(config, importSchedule, summary);
            } catch (backupError) {
              // バックアップ失敗はログに記録するが、インポート成功は維持
              logger?.error(
                { err: backupError, taskId, name: importSchedule.name },
                '[CsvImportScheduler] Auto backup after import failed'
              );
            }
          }

          // 成功した場合は連続失敗回数をリセット
          this.consecutiveFailures.delete(taskId);
        } catch (error) {
          logger?.error(
            { err: error, taskId, name: importSchedule.name },
            '[CsvImportScheduler] Scheduled CSV import failed'
          );

          // インポート履歴を失敗として更新
          const errorMessage = error instanceof Error ? error.message : String(error);
          if (historyId) {
            await this.historyService.failHistory(historyId, errorMessage);
          }

          // アラートを生成
          await this.alertService.generateFailureAlert({
            scheduleId: taskId,
            scheduleName: importSchedule.name,
            errorMessage,
            historyId
          });

          // 連続失敗回数を更新
          const currentFailures = this.consecutiveFailures.get(taskId) || 0;
          const newFailures = currentFailures + 1;
          this.consecutiveFailures.set(taskId, newFailures);

          // 3回連続で失敗した場合は追加アラートを生成
          if (newFailures >= 3) {
            await this.alertService.generateConsecutiveFailureAlert({
              scheduleId: taskId,
              scheduleName: importSchedule.name,
              failureCount: newFailures,
              lastError: errorMessage
            });
          }
        } finally {
          this.runningImports.delete(taskId);
        }
      }, {
        scheduled: true,
        timezone: 'Asia/Tokyo'
      });

      this.tasks.set(taskId, task);
      logger?.info(
        { taskId, name: importSchedule.name, schedule: importSchedule.schedule },
        '[CsvImportScheduler] Scheduled task registered'
      );
    }

    logger?.info(
      { taskCount: this.tasks.size },
      '[CsvImportScheduler] Scheduler started'
    );

    // 履歴クリーンアップJobを開始
    await this.startCleanupJob(config);
  }

  /**
   * 履歴クリーンアップJobを開始
   */
  private async startCleanupJob(config: BackupConfig): Promise<void> {
    // 既存のクリーンアップタスクがあれば停止
    if (this.cleanupTask) {
      this.cleanupTask.stop();
      this.cleanupTask = null;
    }

    // 設定がない場合はスキップ
    if (!config.csvImportHistory) {
      logger?.info('[CsvImportScheduler] No CSV import history cleanup configuration');
      return;
    }

    const { retentionDays = 90, cleanupSchedule = '0 2 * * *' } = config.csvImportHistory;

    // cron形式のバリデーション
    try {
      if (!validate(cleanupSchedule)) {
        logger?.warn(
          { schedule: cleanupSchedule },
          '[CsvImportScheduler] Invalid cleanup schedule format, skipping'
        );
        return;
      }
    } catch (error) {
      logger?.warn(
        { err: error, schedule: cleanupSchedule },
        '[CsvImportScheduler] Invalid cleanup schedule format, skipping'
      );
      return;
    }

    // クリーンアップタスクを作成
    this.cleanupTask = cron.schedule(cleanupSchedule, async () => {
      try {
        logger?.info(
          { retentionDays },
          '[CsvImportScheduler] Starting history cleanup'
        );

        const deletedCount = await this.historyService.cleanupOldHistory(retentionDays);

        logger?.info(
          { deletedCount, retentionDays },
          '[CsvImportScheduler] History cleanup completed'
        );
      } catch (error) {
        logger?.error(
          { err: error },
          '[CsvImportScheduler] History cleanup failed'
        );
      }
    }, {
      scheduled: true,
      timezone: 'Asia/Tokyo'
    });

    logger?.info(
      { schedule: cleanupSchedule, retentionDays },
      '[CsvImportScheduler] History cleanup job registered'
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
      logger?.info({ taskId }, '[CsvImportScheduler] Task stopped');
    }

    // クリーンアップタスクを停止
    if (this.cleanupTask) {
      this.cleanupTask.stop();
      this.cleanupTask = null;
      logger?.info('[CsvImportScheduler] Cleanup task stopped');
    }

    this.tasks.clear();
    this.runningImports.clear();
    this.isRunning = false;
    logger?.info('[CsvImportScheduler] Scheduler stopped');
  }

  /**
   * スケジュールを再読み込み
   */
  async reload(): Promise<void> {
    this.stop();
    await this.start();
  }

  /**
   * 手動でインポートを実行
   */
  async runImport(importId: string): Promise<void> {
    const config = await BackupConfigLoader.load();
    const importSchedule = config.csvImports?.find(imp => imp.id === importId);
    
    if (!importSchedule) {
      throw new Error(`CSV import schedule not found: ${importId}`);
    }

    if (!importSchedule.enabled) {
      throw new Error(`CSV import schedule is disabled: ${importId}`);
    }

    // 既に実行中の場合はエラー
    if (this.runningImports.has(importId)) {
      throw new Error(`CSV import is already running: ${importId}`);
    }

    this.runningImports.add(importId);
    let historyId: string | undefined;
    try {
      logger?.info(
        { taskId: importId, name: importSchedule.name },
        '[CsvImportScheduler] Starting manual CSV import'
      );

      // インポート履歴を作成
      historyId = await this.historyService.createHistory({
        scheduleId: importId,
        scheduleName: importSchedule.name,
        employeesPath: importSchedule.employeesPath,
        itemsPath: importSchedule.itemsPath
      });

      const summary = await this.executeImport(config, importSchedule);

      // インポート履歴を完了として更新
      if (historyId) {
        await this.historyService.completeHistory(historyId, summary);
      }

      logger?.info(
        { taskId: importId, name: importSchedule.name },
        '[CsvImportScheduler] Manual CSV import completed'
      );

      // 自動バックアップが有効な場合、バックアップを実行
      if (importSchedule.autoBackupAfterImport?.enabled) {
        try {
          await this.executeAutoBackup(config, importSchedule, summary);
        } catch (backupError) {
          // バックアップ失敗はログに記録するが、インポート成功は維持
          logger?.error(
            { err: backupError, taskId: importId, name: importSchedule.name },
            '[CsvImportScheduler] Auto backup after import failed'
          );
        }
      }
    } catch (error) {
      logger?.error(
        { err: error, taskId: importId, name: importSchedule.name },
        '[CsvImportScheduler] Manual CSV import failed'
      );

      // インポート履歴を失敗として更新
      const errorMessage = error instanceof Error ? error.message : String(error);
      if (historyId) {
        await this.historyService.failHistory(historyId, errorMessage);
      }

      // アラートを生成
      await this.alertService.generateFailureAlert({
        scheduleId: importId,
        scheduleName: importSchedule.name,
        errorMessage,
        historyId
      });

      throw error;
    } finally {
      this.runningImports.delete(importId);
    }
  }

  /**
   * CSVインポートを実行
   */
  private async executeImport(
    config: BackupConfig,
    importSchedule: NonNullable<BackupConfig['csvImports']>[0]
  ): Promise<{ employees?: { processed: number; created: number; updated: number }; items?: { processed: number; created: number; updated: number } }> {
    // Dropboxストレージプロバイダーを作成
    if (config.storage.provider !== 'dropbox') {
      throw new Error('CSV import from Dropbox requires Dropbox storage provider');
    }

    const accessToken = config.storage.options?.accessToken as string | undefined;
    const refreshToken = config.storage.options?.refreshToken as string | undefined;
    const appKey = config.storage.options?.appKey as string | undefined;
    const appSecret = config.storage.options?.appSecret as string | undefined;
    const basePath = config.storage.options?.basePath as string | undefined;

    if (!accessToken) {
      throw new Error('Dropbox access token is required');
    }

    // OAuthサービスを作成（トークン更新用）
    let oauthService: DropboxOAuthService | undefined;
    if (refreshToken && appKey && appSecret) {
      // スケジューラー実行時はリダイレクトURIは不要だが、型の都合で設定
      oauthService = new DropboxOAuthService({
        appKey,
        appSecret,
        redirectUri: 'http://localhost:8080/api/backup/oauth/callback'
      });
    }

    // トークン更新コールバック
    const onTokenUpdate = async (token: string) => {
      const latestConfig = await BackupConfigLoader.load();
      if (latestConfig.storage.provider === 'dropbox') {
        latestConfig.storage.options = {
          ...(latestConfig.storage.options || {}),
          accessToken: token
        };
        await BackupConfigLoader.save(latestConfig);
        logger?.info({}, '[CsvImportScheduler] Access token updated');
      }
    };

    const dropboxProvider = new DropboxStorageProvider({
      accessToken,
      basePath,
      refreshToken,
      oauthService,
      onTokenUpdate
    });

    // CSVファイルをダウンロード
    const files: { employees?: Buffer; items?: Buffer } = {};
    
    if (importSchedule.employeesPath) {
      logger?.info(
        { path: importSchedule.employeesPath },
        '[CsvImportScheduler] Downloading employees CSV'
      );
      files.employees = await dropboxProvider.download(importSchedule.employeesPath);
      logger?.info(
        { path: importSchedule.employeesPath, size: files.employees.length },
        '[CsvImportScheduler] Employees CSV downloaded'
      );
    }

    if (importSchedule.itemsPath) {
      logger?.info(
        { path: importSchedule.itemsPath },
        '[CsvImportScheduler] Downloading items CSV'
      );
      files.items = await dropboxProvider.download(importSchedule.itemsPath);
      logger?.info(
        { path: importSchedule.itemsPath, size: files.items.length },
        '[CsvImportScheduler] Items CSV downloaded'
      );
    }

    // ファイルが1つもない場合はエラー
    if (!files.employees && !files.items) {
      throw new Error('No CSV files specified in import schedule');
    }

    // CSVインポートを実行
    // loggerをprocessCsvImportの期待する形式にラップ
    const logWrapper = {
      info: (obj: unknown, msg: string) => {
        logger?.info(obj, msg);
      },
      error: (obj: unknown, msg: string) => {
        logger?.error(obj, msg);
      }
    };

    const { summary } = await processCsvImport(
      files,
      importSchedule.replaceExisting ?? false,
      logWrapper
    );

    logger?.info(
      { taskId: importSchedule.id, summary },
      '[CsvImportScheduler] CSV import completed'
    );

    return summary;
  }

  /**
   * CSVインポート成功後の自動バックアップを実行
   */
  private async executeAutoBackup(
    config: BackupConfig,
    importSchedule: NonNullable<BackupConfig['csvImports']>[0],
    importSummary: { employees?: { processed: number; created: number; updated: number }; items?: { processed: number; created: number; updated: number } }
  ): Promise<void> {
    const autoBackupConfig = importSchedule.autoBackupAfterImport;
    if (!autoBackupConfig?.enabled) {
      return;
    }

    logger?.info(
      { taskId: importSchedule.id, targets: autoBackupConfig.targets },
      '[CsvImportScheduler] Starting auto backup after import'
    );

    // ストレージプロバイダーを作成
    let storageProvider;
    if (config.storage.provider === 'dropbox') {
      const accessToken = config.storage.options?.accessToken as string | undefined;
      const refreshToken = config.storage.options?.refreshToken as string | undefined;
      const appKey = config.storage.options?.appKey as string | undefined;
      const appSecret = config.storage.options?.appSecret as string | undefined;
      const basePath = config.storage.options?.basePath as string | undefined;

      if (!accessToken) {
        throw new Error('Dropbox access token is required for auto backup');
      }

      // OAuthサービスを作成（トークン更新用）
      let oauthService: DropboxOAuthService | undefined;
      if (refreshToken && appKey && appSecret) {
        oauthService = new DropboxOAuthService({
          appKey,
          appSecret,
          redirectUri: 'http://localhost:8080/api/backup/oauth/callback'
        });
      }

      // トークン更新コールバック
      const onTokenUpdate = async (token: string) => {
        const latestConfig = await BackupConfigLoader.load();
        if (latestConfig.storage.provider === 'dropbox') {
          latestConfig.storage.options = {
            ...(latestConfig.storage.options || {}),
            accessToken: token
          };
          await BackupConfigLoader.save(latestConfig);
          logger?.info({}, '[CsvImportScheduler] Access token updated during auto backup');
        }
      };

      storageProvider = new DropboxStorageProvider({
        accessToken,
        basePath,
        refreshToken,
        oauthService,
        onTokenUpdate
      });
    } else {
      storageProvider = new LocalStorageProvider();
    }

    const backupService = new BackupService(storageProvider);
    const storageProviderName = config.storage.provider === 'dropbox' ? 'dropbox' : 'local';

    // バックアップ対象に基づいてバックアップを実行
    const backupResults = [];
    for (const target of autoBackupConfig.targets) {
      try {
        if (target === 'csv') {
          // CSVバックアップ: インポートされたデータのみ
          if (importSummary.employees) {
            const employeesBackup = new CsvBackupTarget('employees', {
              label: `auto-after-import-${importSchedule.id}`
            });
            // バックアップデータを取得してハッシュを計算
            const backupData = await employeesBackup.createBackup();
            const verification = BackupVerifier.verify(backupData);
            const hash = verification.hash;

            // バックアップ履歴を作成
            const historyId = await this.backupHistoryService.createHistory({
              operationType: BackupOperationType.BACKUP,
              targetKind: 'csv',
              targetSource: 'employees',
              storageProvider: storageProviderName
            });

            try {
              const result = await backupService.backup(employeesBackup, {
                label: `auto-after-import-${importSchedule.id}-employees`
              });
              backupResults.push(result);

              // バックアップ履歴を完了として更新
              await this.backupHistoryService.completeHistory(historyId, {
                targetKind: 'csv',
                targetSource: 'employees',
                path: result.path,
                sizeBytes: result.sizeBytes,
                hash
              });

              logger?.info(
                { taskId: importSchedule.id, target: 'employees', result, historyId },
                '[CsvImportScheduler] Auto backup completed for employees'
              );
            } catch (backupError) {
              // バックアップ失敗時は履歴を失敗として更新
              const errorMessage = backupError instanceof Error ? backupError.message : String(backupError);
              await this.backupHistoryService.failHistory(historyId, errorMessage);
              throw backupError;
            }
          }
          if (importSummary.items) {
            const itemsBackup = new CsvBackupTarget('items', {
              label: `auto-after-import-${importSchedule.id}`
            });
            // バックアップデータを取得してハッシュを計算
            const backupData = await itemsBackup.createBackup();
            const verification = BackupVerifier.verify(backupData);
            const hash = verification.hash;

            // バックアップ履歴を作成
            const historyId = await this.backupHistoryService.createHistory({
              operationType: BackupOperationType.BACKUP,
              targetKind: 'csv',
              targetSource: 'items',
              storageProvider: storageProviderName
            });

            try {
              const result = await backupService.backup(itemsBackup, {
                label: `auto-after-import-${importSchedule.id}-items`
              });
              backupResults.push(result);

              // バックアップ履歴を完了として更新
              await this.backupHistoryService.completeHistory(historyId, {
                targetKind: 'csv',
                targetSource: 'items',
                path: result.path,
                sizeBytes: result.sizeBytes,
                hash
              });

              logger?.info(
                { taskId: importSchedule.id, target: 'items', result, historyId },
                '[CsvImportScheduler] Auto backup completed for items'
              );
            } catch (backupError) {
              // バックアップ失敗時は履歴を失敗として更新
              const errorMessage = backupError instanceof Error ? backupError.message : String(backupError);
              await this.backupHistoryService.failHistory(historyId, errorMessage);
              throw backupError;
            }
          }
        } else if (target === 'database') {
          // データベースバックアップ
          const dbUrl = process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/borrow_return';
          const databaseBackup = new DatabaseBackupTarget(dbUrl);
          // バックアップデータを取得してハッシュを計算
          const backupData = await databaseBackup.createBackup();
          const verification = BackupVerifier.verify(backupData);
          const hash = verification.hash;

          // バックアップ履歴を作成
          const historyId = await this.backupHistoryService.createHistory({
            operationType: BackupOperationType.BACKUP,
            targetKind: 'database',
            targetSource: 'borrow_return',
            storageProvider: storageProviderName
          });

          try {
            const result = await backupService.backup(databaseBackup, {
              label: `auto-after-import-${importSchedule.id}-database`
            });
            backupResults.push(result);

            // バックアップ履歴を完了として更新
            await this.backupHistoryService.completeHistory(historyId, {
              targetKind: 'database',
              targetSource: 'borrow_return',
              path: result.path,
              sizeBytes: result.sizeBytes,
              hash
            });

            logger?.info(
              { taskId: importSchedule.id, target: 'database', result, historyId },
              '[CsvImportScheduler] Auto backup completed for database'
            );
          } catch (backupError) {
            // バックアップ失敗時は履歴を失敗として更新
            const errorMessage = backupError instanceof Error ? backupError.message : String(backupError);
            await this.backupHistoryService.failHistory(historyId, errorMessage);
            throw backupError;
          }
        } else if (target === 'all') {
          // すべてのバックアップ: CSV + データベース
          if (importSummary.employees) {
            const employeesBackup = new CsvBackupTarget('employees', {
              label: `auto-after-import-${importSchedule.id}`
            });
            const backupData = await employeesBackup.createBackup();
            const verification = BackupVerifier.verify(backupData);
            const hash = verification.hash;

            const historyId = await this.backupHistoryService.createHistory({
              operationType: BackupOperationType.BACKUP,
              targetKind: 'csv',
              targetSource: 'employees',
              storageProvider: storageProviderName
            });

            try {
              const result = await backupService.backup(employeesBackup, {
                label: `auto-after-import-${importSchedule.id}-employees`
              });
              backupResults.push(result);
              await this.backupHistoryService.completeHistory(historyId, {
                targetKind: 'csv',
                targetSource: 'employees',
                path: result.path,
                sizeBytes: result.sizeBytes,
                hash
              });
            } catch (backupError) {
              const errorMessage = backupError instanceof Error ? backupError.message : String(backupError);
              await this.backupHistoryService.failHistory(historyId, errorMessage);
              throw backupError;
            }
          }
          if (importSummary.items) {
            const itemsBackup = new CsvBackupTarget('items', {
              label: `auto-after-import-${importSchedule.id}`
            });
            const backupData = await itemsBackup.createBackup();
            const verification = BackupVerifier.verify(backupData);
            const hash = verification.hash;

            const historyId = await this.backupHistoryService.createHistory({
              operationType: BackupOperationType.BACKUP,
              targetKind: 'csv',
              targetSource: 'items',
              storageProvider: storageProviderName
            });

            try {
              const result = await backupService.backup(itemsBackup, {
                label: `auto-after-import-${importSchedule.id}-items`
              });
              backupResults.push(result);
              await this.backupHistoryService.completeHistory(historyId, {
                targetKind: 'csv',
                targetSource: 'items',
                path: result.path,
                sizeBytes: result.sizeBytes,
                hash
              });
            } catch (backupError) {
              const errorMessage = backupError instanceof Error ? backupError.message : String(backupError);
              await this.backupHistoryService.failHistory(historyId, errorMessage);
              throw backupError;
            }
          }
          const dbUrl = process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/borrow_return';
          const databaseBackup = new DatabaseBackupTarget(dbUrl);
          const backupData = await databaseBackup.createBackup();
          const verification = BackupVerifier.verify(backupData);
          const hash = verification.hash;

          const historyId = await this.backupHistoryService.createHistory({
            operationType: BackupOperationType.BACKUP,
            targetKind: 'database',
            targetSource: 'borrow_return',
            storageProvider: storageProviderName
          });

          try {
            const result = await backupService.backup(databaseBackup, {
              label: `auto-after-import-${importSchedule.id}-database`
            });
            backupResults.push(result);
            await this.backupHistoryService.completeHistory(historyId, {
              targetKind: 'database',
              targetSource: 'borrow_return',
              path: result.path,
              sizeBytes: result.sizeBytes,
              hash
            });
          } catch (backupError) {
            const errorMessage = backupError instanceof Error ? backupError.message : String(backupError);
            await this.backupHistoryService.failHistory(historyId, errorMessage);
            throw backupError;
          }
        }
      } catch (error) {
        logger?.error(
          { err: error, taskId: importSchedule.id, target },
          '[CsvImportScheduler] Auto backup failed for target'
        );
        // 個別のバックアップ失敗は続行（他のバックアップは実行）
      }
    }

    logger?.info(
      { taskId: importSchedule.id, results: backupResults },
      '[CsvImportScheduler] Auto backup after import completed'
    );
  }
}

// シングルトンインスタンス
let schedulerInstance: CsvImportScheduler | null = null;

/**
 * CSVインポートスケジューラーのインスタンスを取得
 */
export function getCsvImportScheduler(): CsvImportScheduler {
  if (!schedulerInstance) {
    schedulerInstance = new CsvImportScheduler();
  }
  return schedulerInstance;
}
