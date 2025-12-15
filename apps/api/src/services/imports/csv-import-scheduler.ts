import cron from 'node-cron';
import { BackupConfigLoader } from '../backup/backup-config.loader.js';
import type { BackupConfig } from '../backup/backup-config.js';
import { DropboxStorageProvider } from '../backup/storage/dropbox-storage.provider.js';
import { DropboxOAuthService } from '../backup/dropbox-oauth.service.js';
import { logger } from '../../lib/logger.js';
import { processCsvImport } from '../../routes/imports.js';
import { ImportHistoryService } from './import-history.service.js';
import { ImportAlertService } from './import-alert.service.js';

/**
 * CSVインポートスケジューラー
 */
export class CsvImportScheduler {
  private tasks: Map<string, cron.ScheduledTask> = new Map();
  private isRunning = false;
  private runningImports: Set<string> = new Set(); // 実行中のインポートID
  private historyService: ImportHistoryService;
  private alertService: ImportAlertService;
  private consecutiveFailures: Map<string, number> = new Map(); // スケジュールID -> 連続失敗回数

  constructor() {
    this.historyService = new ImportHistoryService();
    this.alertService = new ImportAlertService();
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
    
    // csvImportsが設定されていない場合は何もしない
    if (!config.csvImports || config.csvImports.length === 0) {
      logger?.info('[CsvImportScheduler] No CSV import schedules configured');
      this.isRunning = false;
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
