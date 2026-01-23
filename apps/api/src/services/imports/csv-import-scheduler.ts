import cron, { validate } from 'node-cron';
import { BackupConfigLoader } from '../backup/backup-config.loader.js';
import type { BackupConfig } from '../backup/backup-config.js';
import { BackupHistoryService } from '../backup/backup-history.service.js';
import { logger } from '../../lib/logger.js';
import { ImportHistoryService } from './import-history.service.js';
import { ImportAlertService } from './import-alert.service.js';
import { CsvDashboardRetentionService } from '../csv-dashboard/csv-dashboard-retention.service.js';
import { CsvImportAutoBackupService } from './csv-import-auto-backup.service.js';
import { CsvImportExecutionService } from './csv-import-execution.service.js';
import { ApiError } from '../../lib/errors.js';
import { MeasuringInstrumentLoanRetentionService } from '../measuring-instruments/measuring-instrument-loan-retention.service.js';

/**
 * CSVインポートスケジューラー
 */
export class CsvImportScheduler {
  private tasks: Map<string, cron.ScheduledTask> = new Map();
  private cleanupTask: cron.ScheduledTask | null = null;
  private csvDashboardRetentionTask: cron.ScheduledTask | null = null;
  private measuringInstrumentLoanRetentionTask: cron.ScheduledTask | null = null;
  private isRunning = false;
  private runningImports: Set<string> = new Set(); // 実行中のインポートID
  private historyService: ImportHistoryService;
  private alertService: ImportAlertService;
  private backupHistoryService: BackupHistoryService;
  private consecutiveFailures: Map<string, number> = new Map(); // スケジュールID -> 連続失敗回数
  private createExecutionService: () => CsvImportExecutionService;
  private createAutoBackupService: () => CsvImportAutoBackupService;
  private createCsvDashboardRetentionService: () => CsvDashboardRetentionService;
  private createMeasuringInstrumentLoanRetentionService: () => MeasuringInstrumentLoanRetentionService;
  private readonly minIntervalMinutes = 5;

  constructor(overrides: {
    historyService?: ImportHistoryService;
    alertService?: ImportAlertService;
    backupHistoryService?: BackupHistoryService;
    createExecutionService?: () => CsvImportExecutionService;
    createAutoBackupService?: () => CsvImportAutoBackupService;
    createCsvDashboardRetentionService?: () => CsvDashboardRetentionService;
    createMeasuringInstrumentLoanRetentionService?: () => MeasuringInstrumentLoanRetentionService;
  } = {}) {
    this.historyService = new ImportHistoryService();
    this.alertService = new ImportAlertService();
    this.backupHistoryService = new BackupHistoryService();
    this.createExecutionService = () => new CsvImportExecutionService();
    this.createAutoBackupService = () =>
      new CsvImportAutoBackupService({ backupHistoryService: this.backupHistoryService });
    this.createCsvDashboardRetentionService = () => new CsvDashboardRetentionService();
    this.createMeasuringInstrumentLoanRetentionService = () => new MeasuringInstrumentLoanRetentionService();

    if (overrides.historyService) this.historyService = overrides.historyService;
    if (overrides.alertService) this.alertService = overrides.alertService;
    if (overrides.backupHistoryService) this.backupHistoryService = overrides.backupHistoryService;
    if (overrides.createExecutionService) this.createExecutionService = overrides.createExecutionService;
    if (overrides.createAutoBackupService) this.createAutoBackupService = overrides.createAutoBackupService;
    if (overrides.createCsvDashboardRetentionService)
      this.createCsvDashboardRetentionService = overrides.createCsvDashboardRetentionService;
    if (overrides.createMeasuringInstrumentLoanRetentionService)
      this.createMeasuringInstrumentLoanRetentionService = overrides.createMeasuringInstrumentLoanRetentionService;
  }

  private extractIntervalMinutes(schedule: string): number | null {
    const parts = schedule.trim().split(/\s+/);
    if (parts.length !== 5) {
      return null;
    }
    const [minute, hour, dayOfMonth, month] = parts;
    if (hour !== '*' || dayOfMonth !== '*' || month !== '*') {
      return null;
    }
    if (minute === '*') {
      return 1;
    }
    if (minute.startsWith('*/')) {
      const interval = parseInt(minute.slice(2), 10);
      return Number.isInteger(interval) ? interval : null;
    }
    return null;
  }

  private async executeSingleRun(params: {
    config: BackupConfig;
    importSchedule: NonNullable<BackupConfig['csvImports']>[0];
    isManual: boolean;
  }): Promise<{
    employees?: { processed: number; created: number; updated: number };
    items?: { processed: number; created: number; updated: number };
    measuringInstruments?: { processed: number; created: number; updated: number };
    riggingGears?: { processed: number; created: number; updated: number };
    csvDashboards?: Record<
      string,
      { rowsProcessed: number; rowsAdded: number; rowsSkipped: number; debug?: unknown }
    >;
  }> {
    const { config, importSchedule, isManual } = params;
    const taskId = importSchedule.id;
    let historyId: string | undefined;

    try {
      logger?.info(
        { taskId, name: importSchedule.name },
        isManual ? '[CsvImportScheduler] Starting manual CSV import' : '[CsvImportScheduler] Starting scheduled CSV import'
      );

      // インポート履歴を作成（旧形式との互換性のため）
      historyId = await this.historyService.createHistory({
        scheduleId: taskId,
        scheduleName: importSchedule.name,
        employeesPath: importSchedule.employeesPath,
        itemsPath: importSchedule.itemsPath,
      });

      const summary = await this.executeImport(config, importSchedule, isManual);

      // インポート履歴を完了として更新
      if (historyId) {
        await this.historyService.completeHistory(historyId, summary);
      }

      logger?.info(
        { taskId, name: importSchedule.name },
        isManual ? '[CsvImportScheduler] Manual CSV import completed' : '[CsvImportScheduler] Scheduled CSV import completed'
      );

      // 自動バックアップが有効な場合、バックアップを実行
      if (importSchedule.autoBackupAfterImport?.enabled) {
        try {
          const autoBackupService = this.createAutoBackupService();
          await autoBackupService.execute({
            config,
            importSchedule,
            importSummary: summary,
          });
        } catch (backupError) {
          // バックアップ失敗はログに記録するが、インポート成功は維持
          logger?.error(
            { err: backupError, taskId, name: importSchedule.name },
            '[CsvImportScheduler] Auto backup after import failed'
          );
        }
      }

      // scheduledのみ: 成功した場合は連続失敗回数をリセット
      if (!isManual) {
        this.consecutiveFailures.delete(taskId);
      }

      return summary;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      let alertMessage = errorMessage;
      if (error instanceof ApiError && error.code === 'CSV_HEADER_MISMATCH') {
        const details = error.details as { missingColumn?: string; internalName?: string; candidates?: string[] } | undefined;
        alertMessage = [
          'CSVインポートが列構成不一致で失敗しました。',
          details?.missingColumn
            ? `不足列: ${details.missingColumn}${details.internalName ? ` (内部名: ${details.internalName})` : ''}`
            : undefined,
          details?.candidates?.length ? `候補: ${details.candidates.join(', ')}` : undefined,
          '対応: CSVヘッダー行を確認し、必要なら管理コンソールで列定義の候補を追加してください。'
        ]
          .filter(Boolean)
          .join(' ');
      }

      // #region agent log
      fetch('http://127.0.0.1:7242/ingest/efef6d23-e2ed-411f-be56-ab093f2725f8',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({sessionId:'debug-session',runId:'pre-fix',hypothesisId:'H3',location:'csv-import-scheduler.ts:executeSingleRun',message:'executeSingleRun error',data:{taskId,errorName:error instanceof Error ? error.name : 'unknown',errorMessage},timestamp:Date.now()})}).catch(()=>{});
      // #endregion

      logger?.error(
        { err: error, taskId, name: importSchedule.name },
        isManual ? '[CsvImportScheduler] Manual CSV import failed' : '[CsvImportScheduler] Scheduled CSV import failed'
      );

      // インポート履歴を失敗として更新
      if (historyId) {
        await this.historyService.failHistory(historyId, errorMessage);
      }

      // アラートを生成（manual/scheduled共通）
      await this.alertService.generateFailureAlert({
        scheduleId: taskId,
        scheduleName: importSchedule.name,
        errorMessage: alertMessage,
        historyId,
      });

      // scheduledのみ: 連続失敗回数を更新
      if (!isManual) {
        const currentFailures = this.consecutiveFailures.get(taskId) || 0;
        const newFailures = currentFailures + 1;
        this.consecutiveFailures.set(taskId, newFailures);

        // 3回連続で失敗した場合は追加アラートを生成
        if (newFailures >= 3) {
          await this.alertService.generateConsecutiveFailureAlert({
            scheduleId: taskId,
            scheduleName: importSchedule.name,
            failureCount: newFailures,
            lastError: errorMessage,
          });
        }
      }

      throw error;
    }
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
      // 計測機器持出返却イベントの年次削除Jobを開始
      await this.startMeasuringInstrumentLoanRetentionJob();
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

      const intervalMinutes = this.extractIntervalMinutes(importSchedule.schedule);
      if (intervalMinutes !== null && intervalMinutes < this.minIntervalMinutes) {
        logger?.warn(
          { taskId, name: importSchedule.name, schedule: importSchedule.schedule, intervalMinutes },
          '[CsvImportScheduler] Schedule interval is too short, skipping'
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
        try {
          await this.executeSingleRun({ config, importSchedule, isManual: false });
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

    // 計測機器持出返却イベントの年次削除Jobを開始
    await this.startMeasuringInstrumentLoanRetentionJob();
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

        const retentionService = this.createCsvDashboardRetentionService();
        const { deletedRows, deletedIngestRuns, deletedFiles, deletedSize } =
          await retentionService.cleanup();

        logger?.info(
          { deletedRows, deletedIngestRuns, deletedFiles, deletedSize },
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
   * 計測機器持出返却イベントの年次削除Jobを開始
   */
  private async startMeasuringInstrumentLoanRetentionJob(): Promise<void> {
    if (this.measuringInstrumentLoanRetentionTask) {
      this.measuringInstrumentLoanRetentionTask.stop();
      this.measuringInstrumentLoanRetentionTask = null;
    }

    // 1月中の2:30に実行（年次削除）
    const retentionSchedule = '0 30 2 1 *';

    try {
      if (!validate(retentionSchedule)) {
        logger?.warn(
          { schedule: retentionSchedule },
          '[CsvImportScheduler] Invalid measuring instrument retention schedule format, skipping'
        );
        return;
      }
    } catch (error) {
      logger?.warn(
        { err: error, schedule: retentionSchedule },
        '[CsvImportScheduler] Invalid measuring instrument retention schedule format, skipping'
      );
      return;
    }

    this.measuringInstrumentLoanRetentionTask = cron.schedule(retentionSchedule, async () => {
      try {
        logger?.info(
          '[CsvImportScheduler] Starting measuring instrument loan retention cleanup'
        );

        const retentionService = this.createMeasuringInstrumentLoanRetentionService();
        const { deletedEvents, twoYearsAgo } = await retentionService.cleanupTwoYearsAgo();

        logger?.info(
          { deletedEvents, twoYearsAgo },
          '[CsvImportScheduler] Measuring instrument loan retention cleanup completed'
        );
      } catch (error) {
        logger?.error(
          { err: error },
          '[CsvImportScheduler] Measuring instrument loan retention cleanup failed'
        );
      }
    }, {
      scheduled: true,
      timezone: 'Asia/Tokyo'
    });

    logger?.info(
      { schedule: retentionSchedule },
      '[CsvImportScheduler] Measuring instrument loan retention job registered'
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
  async runImport(importId: string): Promise<Awaited<ReturnType<CsvImportScheduler['executeSingleRun']>>> {
    const config = await BackupConfigLoader.load();
    const importSchedule = config.csvImports?.find(imp => imp.id === importId);
    
    if (!importSchedule) {
      throw new Error(`CSV import schedule not found: ${importId}`);
    }

    // #region agent log
    fetch('http://127.0.0.1:7242/ingest/efef6d23-e2ed-411f-be56-ab093f2725f8',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({sessionId:'debug-session',runId:'pre-fix',hypothesisId:'H1',location:'csv-import-scheduler.ts:runImport',message:'runImport schedule loaded',data:{importId,enabled:importSchedule.enabled,provider:importSchedule.provider || 'default',targetTypes:(importSchedule.targets || []).map(target => target.type),targetSources:(importSchedule.targets || []).map(target => target.source)},timestamp:Date.now()})}).catch(()=>{});
    // #endregion

    if (!importSchedule.enabled) {
      throw new Error(`CSV import schedule is disabled: ${importId}`);
    }

    // 既に実行中の場合はエラー
    if (this.runningImports.has(importId)) {
      throw new Error(`CSV import is already running: ${importId}`);
    }

    this.runningImports.add(importId);
    try {
      return await this.executeSingleRun({ config, importSchedule, isManual: true });
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
  ) {
    // #region agent log
    fetch('http://127.0.0.1:7242/ingest/efef6d23-e2ed-411f-be56-ab093f2725f8',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({sessionId:'debug-session',runId:'pre-fix',hypothesisId:'H2',location:'csv-import-scheduler.ts:executeImport',message:'executeImport start',data:{scheduleId:importSchedule.id,skipRetry,provider:importSchedule.provider || 'default',hasTargets:Array.isArray(importSchedule.targets) && importSchedule.targets.length > 0},timestamp:Date.now()})}).catch(()=>{});
    // #endregion
    const executionService = this.createExecutionService();
    return await executionService.execute({ config, importSchedule, skipRetry });
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
