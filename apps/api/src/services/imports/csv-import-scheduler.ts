import cron, { validate } from 'node-cron';
import { BackupConfigLoader } from '../backup/backup-config.loader.js';
import type { BackupConfig } from '../backup/backup-config.js';
import { StorageProviderFactory } from '../backup/storage-provider-factory.js';
import { BackupService } from '../backup/backup.service.js';
import { CsvBackupTarget } from '../backup/targets/csv-backup.target.js';
import { DatabaseBackupTarget } from '../backup/targets/database-backup.target.js';
import { BackupHistoryService } from '../backup/backup-history.service.js';
import { BackupVerifier } from '../backup/backup-verifier.js';
import { BackupOperationType } from '@prisma/client';
import { logger } from '../../lib/logger.js';
import { processCsvImportFromTargets } from '../../routes/imports.js';
import { ImportHistoryService } from './import-history.service.js';
import { ImportAlertService } from './import-alert.service.js';
import type { CsvImportTarget } from './csv-importer.types.js';
import { CsvDashboardIngestor } from '../csv-dashboard/csv-dashboard-ingestor.js';
import { CsvDashboardStorage } from '../../lib/csv-dashboard-storage.js';
import { prisma } from '../../lib/prisma.js';
import { CsvDashboardService } from '../csv-dashboard/csv-dashboard.service.js';

/**
 * CSVインポートスケジューラー
 */
export class CsvImportScheduler {
  private tasks: Map<string, cron.ScheduledTask> = new Map();
  private cleanupTask: cron.ScheduledTask | null = null;
  private csvDashboardRetentionTask: cron.ScheduledTask | null = null;
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
      // CSVダッシュボードレテンション削除Jobを開始
      await this.startCsvDashboardRetentionJob();
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

          // インポート履歴を作成（旧形式との互換性のため）
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
    
    // CSVダッシュボードレテンション削除Jobを開始
    await this.startCsvDashboardRetentionJob();
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
   * CSVダッシュボードレテンション削除Jobを開始
   */
  private async startCsvDashboardRetentionJob(): Promise<void> {
    // 既存のレテンション削除タスクがあれば停止
    if (this.csvDashboardRetentionTask) {
      this.csvDashboardRetentionTask.stop();
      this.csvDashboardRetentionTask = null;
    }

    // デフォルトスケジュール: 毎月1日の2時（前月分を削除）
    const retentionSchedule = '0 2 1 * *';

    // cron形式のバリデーション
    try {
      if (!validate(retentionSchedule)) {
        logger?.warn(
          { schedule: retentionSchedule },
          '[CsvImportScheduler] Invalid CSV dashboard retention schedule format, skipping'
        );
        return;
      }
    } catch (error) {
      logger?.warn(
        { err: error, schedule: retentionSchedule },
        '[CsvImportScheduler] Invalid CSV dashboard retention schedule format, skipping'
      );
      return;
    }

    // レテンション削除タスクを作成
    this.csvDashboardRetentionTask = cron.schedule(retentionSchedule, async () => {
      try {
        logger?.info(
          '[CsvImportScheduler] Starting CSV dashboard retention cleanup'
        );

        const csvDashboardService = new CsvDashboardService();
        const { deletedRows, deletedIngestRuns } = await csvDashboardService.cleanupOldData();

        // CSVファイルのレテンション削除も実行
        const { deletedCount, deletedSize } = await CsvDashboardStorage.cleanupOldFiles();

        logger?.info(
          { deletedRows, deletedIngestRuns, deletedFiles: deletedCount, deletedSize },
          '[CsvImportScheduler] CSV dashboard retention cleanup completed'
        );
      } catch (error) {
        logger?.error(
          { err: error },
          '[CsvImportScheduler] CSV dashboard retention cleanup failed'
        );
      }
    }, {
      scheduled: true,
      timezone: 'Asia/Tokyo'
    });

    logger?.info(
      { schedule: retentionSchedule },
      '[CsvImportScheduler] CSV dashboard retention job registered'
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

    // CSVダッシュボードレテンション削除タスクを停止
    if (this.csvDashboardRetentionTask) {
      this.csvDashboardRetentionTask.stop();
      this.csvDashboardRetentionTask = null;
      logger?.info('[CsvImportScheduler] CSV dashboard retention task stopped');
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

      // インポート履歴を作成（旧形式との互換性のため）
      historyId = await this.historyService.createHistory({
        scheduleId: importId,
        scheduleName: importSchedule.name,
        employeesPath: importSchedule.employeesPath,
        itemsPath: importSchedule.itemsPath
      });

      // 手動実行の場合はリトライをスキップ
      const summary = await this.executeImport(config, importSchedule, true);

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
   * CSVインポートを実行（リトライ機能付き）
   * @param skipRetry 手動実行の場合はtrueを指定してリトライをスキップ
   */
  private async executeImport(
    config: BackupConfig,
    importSchedule: NonNullable<BackupConfig['csvImports']>[0],
    skipRetry = false
  ): Promise<{ employees?: { processed: number; created: number; updated: number }; items?: { processed: number; created: number; updated: number }; measuringInstruments?: { processed: number; created: number; updated: number }; riggingGears?: { processed: number; created: number; updated: number }; csvDashboards?: Record<string, { rowsProcessed: number; rowsAdded: number; rowsSkipped: number }> }> {
    // プロバイダーを決定（スケジュール固有のプロバイダーまたは全体設定）
    const provider = importSchedule.provider || config.storage.provider;
    
    if (provider !== 'dropbox' && provider !== 'gmail') {
      throw new Error(`CSV import requires Dropbox or Gmail storage provider, but got: ${provider}`);
    }

    // 手動実行の場合はリトライをスキップして直接実行
    if (skipRetry) {
      return await this.executeImportAttempt(config, importSchedule, provider);
    }

    // リトライ設定
    const retryConfig = importSchedule.retryConfig || {
      maxRetries: 3,
      retryInterval: 60,
      exponentialBackoff: true
    };

    // リトライロジックでインポートを実行
    let lastError: Error | undefined;
    for (let attempt = 0; attempt <= retryConfig.maxRetries; attempt++) {
      try {
        return await this.executeImportAttempt(config, importSchedule, provider);
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        
        if (attempt < retryConfig.maxRetries) {
          const delay = retryConfig.exponentialBackoff
            ? retryConfig.retryInterval * Math.pow(2, attempt)
            : retryConfig.retryInterval;
          
          logger?.warn(
            { 
              attempt: attempt + 1, 
              maxRetries: retryConfig.maxRetries,
              delay,
              error: lastError.message
            },
            '[CsvImportScheduler] Import attempt failed, retrying'
          );
          
          await new Promise(resolve => setTimeout(resolve, delay * 1000));
        }
      }
    }

    // すべてのリトライが失敗した場合
    throw new Error(`CSV import failed after ${retryConfig.maxRetries + 1} attempts: ${lastError?.message}`);
  }

  /**
   * CSVインポートの1回の試行を実行
   */
  private async executeImportAttempt(
    config: BackupConfig,
    importSchedule: NonNullable<BackupConfig['csvImports']>[0],
    provider: 'dropbox' | 'gmail'
  ): Promise<{ employees?: { processed: number; created: number; updated: number }; items?: { processed: number; created: number; updated: number }; measuringInstruments?: { processed: number; created: number; updated: number }; riggingGears?: { processed: number; created: number; updated: number }; csvDashboards?: Record<string, { rowsProcessed: number; rowsAdded: number; rowsSkipped: number }> }> {
    // ストレージプロバイダーを作成（Factoryパターンを使用）
    const protocol = 'http'; // スケジューラー内ではプロトコルは不要
    const host = 'localhost:8080'; // スケジューラー内ではホストは不要
    
    // トークン更新コールバック（provider別名前空間へ保存）
    const onTokenUpdate = async (token: string) => {
      const latestConfig = await BackupConfigLoader.load();
      // NOTE: global provider(dropbox)運用でも、CSV import provider(gmail)のトークン更新を保存できるようにする
      if (provider === 'gmail') {
        latestConfig.storage.options = {
          ...(latestConfig.storage.options || {}),
          gmail: {
            ...latestConfig.storage.options?.gmail,
            accessToken: token
          }
        };
      } else if (provider === 'dropbox') {
        latestConfig.storage.options = {
          ...(latestConfig.storage.options || {}),
          dropbox: {
            ...latestConfig.storage.options?.dropbox,
            accessToken: token
          }
        };
      }
      await BackupConfigLoader.save(latestConfig);
      logger?.info({ provider }, '[CsvImportScheduler] Access token updated');
    };

    // StorageProviderFactoryを使用してプロバイダーを作成
    const storageProvider = await StorageProviderFactory.createFromConfig(
      {
        ...config,
        storage: {
          ...config.storage,
          provider
        }
      },
      protocol,
      host,
      onTokenUpdate
    );

    // ターゲットを取得（新形式優先、旧形式は変換）
    let targets: CsvImportTarget[] = [];
    if (importSchedule.targets && importSchedule.targets.length > 0) {
      targets = importSchedule.targets;
    } else {
      // 旧形式から新形式へ変換
      if (importSchedule.employeesPath) {
        targets.push({ type: 'employees', source: importSchedule.employeesPath });
      }
      if (importSchedule.itemsPath) {
        targets.push({ type: 'items', source: importSchedule.itemsPath });
      }
    }

    if (targets.length === 0) {
      throw new Error('No CSV import targets specified in import schedule');
    }

    // CSVダッシュボード用のターゲットと通常のインポート用のターゲットを分離
    const csvDashboardTargets = targets.filter((t) => t.type === 'csvDashboards');
    const importTargets = targets.filter((t) => t.type !== 'csvDashboards');

    // CSVファイルをダウンロード
    const fileMap = new Map<string, Buffer>();
    const csvDashboardResults: Record<string, { rowsProcessed: number; rowsAdded: number; rowsSkipped: number }> = {};

    // CSVダッシュボード用の処理
    if (csvDashboardTargets.length > 0) {
      const ingestor = new CsvDashboardIngestor();
      
      // GmailStorageProviderの場合はメタデータ付きダウンロードを使用
      const isGmailProvider = provider === 'gmail';
      
      for (const target of csvDashboardTargets) {
        // sourceはCSVダッシュボードID
        const dashboardId = target.source;
        
        // CSVダッシュボードの設定を取得（Gmail件名パターンを取得するため）
        const dashboard = await prisma.csvDashboard.findUnique({
          where: { id: dashboardId },
        });
        
        if (!dashboard) {
          logger?.warn(
            { dashboardId },
            '[CsvImportScheduler] CSV dashboard not found, skipping'
          );
          continue;
        }
        
        if (!dashboard.enabled) {
          logger?.warn(
            { dashboardId },
            '[CsvImportScheduler] CSV dashboard is disabled, skipping'
          );
          continue;
        }
        
        // Gmail件名パターンを取得（CSVダッシュボード設定から取得）
        // NOTE: target.source は dashboardId であり、件名パターンとは別物
        const gmailSubjectPattern = (dashboard as unknown as { gmailSubjectPattern?: string | null })
          .gmailSubjectPattern;
        if (!gmailSubjectPattern || gmailSubjectPattern.trim().length === 0) {
          logger?.warn(
            { dashboardId, provider },
            '[CsvImportScheduler] CSV dashboard gmailSubjectPattern is not set, skipping'
          );
          continue;
        }
        
        logger?.info(
          { dashboardId, gmailSubjectPattern, provider },
          '[CsvImportScheduler] Processing CSV dashboard ingestion'
        );

        let buffer: Buffer;
        let messageId: string | undefined;
        let messageSubject: string | undefined;

        if (isGmailProvider && 'downloadWithMetadata' in storageProvider) {
          // GmailStorageProviderの場合はメタデータ付きダウンロードを使用
          const gmailProvider = storageProvider as {
            downloadWithMetadata: (path: string) => Promise<{
              buffer: Buffer;
              messageId: string;
              messageSubject: string;
            }>;
          };
          const result = await gmailProvider.downloadWithMetadata(gmailSubjectPattern);
          buffer = result.buffer;
          messageId = result.messageId;
          messageSubject = result.messageSubject;
        } else {
          // DropboxStorageProviderの場合は通常のダウンロードを使用
          buffer = await storageProvider.download(gmailSubjectPattern);
        }

        const csvContent = buffer.toString('utf-8');

        // CSVファイルを原本として保存
        const csvFilePath = await CsvDashboardStorage.saveRawCsv(dashboardId, buffer, messageId);

        // 取り込み処理を実行
        const result = await ingestor.ingestFromGmail(
          dashboardId,
          csvContent,
          messageId,
          messageSubject,
          csvFilePath
        );

        csvDashboardResults[dashboardId] = result;

        logger?.info(
          { dashboardId, result },
          '[CsvImportScheduler] CSV dashboard ingestion completed'
        );
      }
    }

    // 通常のCSVインポート処理
    if (importTargets.length > 0) {
      for (const target of importTargets) {
        logger?.info(
          { type: target.type, source: target.source, provider },
          `[CsvImportScheduler] Downloading ${target.type} CSV`
        );
        const buffer = await storageProvider.download(target.source);
        fileMap.set(target.type, buffer);
        logger?.info(
          { type: target.type, source: target.source, size: buffer.length, provider },
          `[CsvImportScheduler] ${target.type} CSV downloaded`
        );
      }

      // CSVインポートを実行
      const logWrapper = {
        info: (obj: unknown, msg: string) => {
          logger?.info(obj, msg);
        },
        error: (obj: unknown, msg: string) => {
          logger?.error(obj, msg);
        }
      };

      const { summary } = await processCsvImportFromTargets(
        importTargets,
        fileMap,
        importSchedule.replaceExisting ?? false,
        logWrapper
      );

      logger?.info(
        { taskId: importSchedule.id, summary },
        '[CsvImportScheduler] CSV import completed'
      );

      // CSVダッシュボードの結果も含めて返す
      return { ...summary, csvDashboards: csvDashboardResults };
    }

    // CSVダッシュボードのみの場合
    return { csvDashboards: csvDashboardResults };
  }

  /**
   * CSVインポート成功後の自動バックアップを実行
   */
  private async executeAutoBackup(
    config: BackupConfig,
    importSchedule: NonNullable<BackupConfig['csvImports']>[0],
    importSummary: { employees?: { processed: number; created: number; updated: number }; items?: { processed: number; created: number; updated: number }; measuringInstruments?: { processed: number; created: number; updated: number }; riggingGears?: { processed: number; created: number; updated: number }; csvDashboards?: Record<string, { rowsProcessed: number; rowsAdded: number; rowsSkipped: number }> }
  ): Promise<void> {
    const autoBackupConfig = importSchedule.autoBackupAfterImport;
    if (!autoBackupConfig?.enabled) {
      return;
    }

    logger?.info(
      { taskId: importSchedule.id, targets: autoBackupConfig.targets },
      '[CsvImportScheduler] Starting auto backup after import'
    );

    // ストレージプロバイダーを作成（Factoryパターンを使用）
    const protocol = 'http';
    const host = 'localhost:8080';
    
    // トークン更新コールバック（provider別名前空間へ保存）
    const onTokenUpdate = async (token: string) => {
      const latestConfig = await BackupConfigLoader.load();
      const currentProvider = latestConfig.storage.provider;
      if (currentProvider === 'gmail') {
        latestConfig.storage.options = {
          ...(latestConfig.storage.options || {}),
          gmail: {
            ...latestConfig.storage.options?.gmail,
            accessToken: token
          }
        };
        await BackupConfigLoader.save(latestConfig);
        logger?.info({ provider: currentProvider }, '[CsvImportScheduler] Access token updated during auto backup');
      } else if (currentProvider === 'dropbox') {
        latestConfig.storage.options = {
          ...(latestConfig.storage.options || {}),
          dropbox: {
            ...latestConfig.storage.options?.dropbox,
            accessToken: token
          }
        };
        await BackupConfigLoader.save(latestConfig);
        logger?.info({ provider: currentProvider }, '[CsvImportScheduler] Access token updated during auto backup');
      }
    };

    const storageProvider = await StorageProviderFactory.createFromConfig(
      config,
      protocol,
      host,
      onTokenUpdate
    );

    const backupService = new BackupService(storageProvider);
    const storageProviderName = config.storage.provider;

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
