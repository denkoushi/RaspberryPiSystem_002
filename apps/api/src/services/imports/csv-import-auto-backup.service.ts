import type { BackupConfig } from '../backup/backup-config.js';
import { BackupConfigLoader } from '../backup/backup-config.loader.js';
import { StorageProviderFactory } from '../backup/storage-provider-factory.js';
import { BackupService } from '../backup/backup.service.js';
import type { StorageProvider } from '../backup/storage/storage-provider.interface.js';
import { CsvBackupTarget } from '../backup/targets/csv-backup.target.js';
import { DatabaseBackupTarget } from '../backup/targets/database-backup.target.js';
import { BackupHistoryService } from '../backup/backup-history.service.js';
import { BackupVerifier } from '../backup/backup-verifier.js';
import { BackupOperationType } from '@prisma/client';
import { logger } from '../../lib/logger.js';

export type CsvImportRunSummary = {
  employees?: { processed: number; created: number; updated: number };
  items?: { processed: number; created: number; updated: number };
  measuringInstruments?: { processed: number; created: number; updated: number };
  riggingGears?: { processed: number; created: number; updated: number };
  csvDashboards?: Record<string, { rowsProcessed: number; rowsAdded: number; rowsSkipped: number }>;
};

type LoggerLike = {
  info?: (obj: unknown, msg: string) => void;
  warn?: (obj: unknown, msg: string) => void;
  error?: (obj: unknown, msg: string) => void;
};

export interface BackupConfigStore {
  load(): Promise<BackupConfig>;
  save(config: BackupConfig): Promise<void>;
}

export interface StorageProviderFactoryLike {
  createFromConfig(
    config: BackupConfig,
    requestProtocol?: string,
    requestHost?: string,
    onTokenUpdate?: (token: string) => Promise<void>
  ): Promise<StorageProvider>;
}

type BackupServiceLike = {
  backup: (target: { info: { type: string; source: string }; createBackup: () => Promise<Buffer> }, options?: { label?: string }) => Promise<{
    success: boolean;
    path?: string;
    sizeBytes?: number;
    timestamp: Date;
  }>;
};

type BackupVerifierLike = {
  verify: (data: Buffer) => { hash: string };
};

type BackupTargetLike = {
  info: { type: string; source: string };
  createBackup: () => Promise<Buffer>;
};

type CsvBackupSource = 'employees' | 'items';

/**
 * CSVインポート成功後の自動バックアップ実行を担当するサービス。
 * schedulerの責務（スケジュール/実行制御）から分離し、外部I/Oを局所化する。
 */
export class CsvImportAutoBackupService {
  private readonly backupHistoryService: BackupHistoryService;
  private readonly configStore: BackupConfigStore;
  private readonly storageProviderFactory: StorageProviderFactoryLike;
  private readonly createBackupService: (storageProvider: StorageProvider) => BackupServiceLike;
  private readonly createCsvBackupTarget: (source: CsvBackupSource, options: { label: string }) => BackupTargetLike;
  private readonly createDatabaseBackupTarget: (dbUrl: string) => BackupTargetLike;
  private readonly verifier: BackupVerifierLike;
  private readonly getDatabaseUrl: () => string;
  private readonly log: LoggerLike;

  constructor(overrides: {
    backupHistoryService?: BackupHistoryService;
    configStore?: BackupConfigStore;
    storageProviderFactory?: StorageProviderFactoryLike;
    createBackupService?: (storageProvider: StorageProvider) => BackupServiceLike;
    createCsvBackupTarget?: (source: CsvBackupSource, options: { label: string }) => BackupTargetLike;
    createDatabaseBackupTarget?: (dbUrl: string) => BackupTargetLike;
    verifier?: BackupVerifierLike;
    getDatabaseUrl?: () => string;
    logger?: LoggerLike;
  } = {}) {
    this.backupHistoryService = overrides.backupHistoryService ?? new BackupHistoryService();
    this.configStore = overrides.configStore ?? { load: BackupConfigLoader.load, save: BackupConfigLoader.save };
    this.storageProviderFactory = overrides.storageProviderFactory ?? { createFromConfig: StorageProviderFactory.createFromConfig };
    this.createBackupService =
      overrides.createBackupService ?? ((storageProvider) => new BackupService(storageProvider));
    this.createCsvBackupTarget =
      overrides.createCsvBackupTarget ?? ((source, options) => new CsvBackupTarget(source, options));
    this.createDatabaseBackupTarget =
      overrides.createDatabaseBackupTarget ?? ((dbUrl) => new DatabaseBackupTarget(dbUrl));
    this.verifier = overrides.verifier ?? BackupVerifier;
    this.getDatabaseUrl =
      overrides.getDatabaseUrl ??
      (() => process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/borrow_return');
    this.log = overrides.logger ?? logger ?? {};
  }

  async execute(params: {
    config: BackupConfig;
    importSchedule: NonNullable<BackupConfig['csvImports']>[0];
    importSummary: CsvImportRunSummary;
  }): Promise<void> {
    const { config, importSchedule, importSummary } = params;

    const autoBackupConfig = importSchedule.autoBackupAfterImport;
    if (!autoBackupConfig?.enabled) {
      return;
    }

    this.log.info?.(
      { taskId: importSchedule.id, targets: autoBackupConfig.targets },
      '[CsvImportScheduler] Starting auto backup after import'
    );

    // ストレージプロバイダーを作成（Factoryパターンを使用）
    const protocol = 'http';
    const host = 'localhost:8080';

    // トークン更新コールバック（provider別名前空間へ保存）
    const onTokenUpdate = async (token: string) => {
      const latestConfig = await this.configStore.load();
      const currentProvider = latestConfig.storage.provider;
      if (currentProvider === 'gmail') {
        latestConfig.storage.options = {
          ...(latestConfig.storage.options || {}),
          gmail: {
            ...latestConfig.storage.options?.gmail,
            accessToken: token,
          },
        };
        await this.configStore.save(latestConfig);
        this.log.info?.(
          { provider: currentProvider },
          '[CsvImportScheduler] Access token updated during auto backup'
        );
      } else if (currentProvider === 'dropbox') {
        latestConfig.storage.options = {
          ...(latestConfig.storage.options || {}),
          dropbox: {
            ...latestConfig.storage.options?.dropbox,
            accessToken: token,
          },
        };
        await this.configStore.save(latestConfig);
        this.log.info?.(
          { provider: currentProvider },
          '[CsvImportScheduler] Access token updated during auto backup'
        );
      }
    };

    const storageProvider = await this.storageProviderFactory.createFromConfig(config, protocol, host, onTokenUpdate);

    const backupService = this.createBackupService(storageProvider);
    const storageProviderName = config.storage.provider;

    // バックアップ対象に基づいてバックアップを実行
    const backupResults = [];
    for (const target of autoBackupConfig.targets) {
      try {
        if (target === 'csv') {
          // CSVバックアップ: インポートされたデータのみ
          if (importSummary.employees) {
            const employeesBackup = this.createCsvBackupTarget('employees', {
              label: `auto-after-import-${importSchedule.id}`,
            });
            // バックアップデータを取得してハッシュを計算
            const backupData = await employeesBackup.createBackup();
            const hash = this.verifier.verify(backupData).hash;

            // バックアップ履歴を作成
            const historyId = await this.backupHistoryService.createHistory({
              operationType: BackupOperationType.BACKUP,
              targetKind: 'csv',
              targetSource: 'employees',
              storageProvider: storageProviderName,
            });

            try {
              const result = await backupService.backup(employeesBackup, {
                label: `auto-after-import-${importSchedule.id}-employees`,
              });
              backupResults.push(result);

              // バックアップ履歴を完了として更新
              await this.backupHistoryService.completeHistory(historyId, {
                targetKind: 'csv',
                targetSource: 'employees',
                path: result.path,
                sizeBytes: result.sizeBytes,
                hash,
              });

              this.log.info?.(
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
            const itemsBackup = this.createCsvBackupTarget('items', {
              label: `auto-after-import-${importSchedule.id}`,
            });
            // バックアップデータを取得してハッシュを計算
            const backupData = await itemsBackup.createBackup();
            const hash = this.verifier.verify(backupData).hash;

            // バックアップ履歴を作成
            const historyId = await this.backupHistoryService.createHistory({
              operationType: BackupOperationType.BACKUP,
              targetKind: 'csv',
              targetSource: 'items',
              storageProvider: storageProviderName,
            });

            try {
              const result = await backupService.backup(itemsBackup, {
                label: `auto-after-import-${importSchedule.id}-items`,
              });
              backupResults.push(result);

              // バックアップ履歴を完了として更新
              await this.backupHistoryService.completeHistory(historyId, {
                targetKind: 'csv',
                targetSource: 'items',
                path: result.path,
                sizeBytes: result.sizeBytes,
                hash,
              });

              this.log.info?.(
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
          const dbUrl = this.getDatabaseUrl();
          const databaseBackup = this.createDatabaseBackupTarget(dbUrl);
          // バックアップデータを取得してハッシュを計算
          const backupData = await databaseBackup.createBackup();
          const hash = this.verifier.verify(backupData).hash;

          // バックアップ履歴を作成
          const historyId = await this.backupHistoryService.createHistory({
            operationType: BackupOperationType.BACKUP,
            targetKind: 'database',
            targetSource: 'borrow_return',
            storageProvider: storageProviderName,
          });

          try {
            const result = await backupService.backup(databaseBackup, {
              label: `auto-after-import-${importSchedule.id}-database`,
            });
            backupResults.push(result);

            // バックアップ履歴を完了として更新
            await this.backupHistoryService.completeHistory(historyId, {
              targetKind: 'database',
              targetSource: 'borrow_return',
              path: result.path,
              sizeBytes: result.sizeBytes,
              hash,
            });

            this.log.info?.(
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
            const employeesBackup = this.createCsvBackupTarget('employees', {
              label: `auto-after-import-${importSchedule.id}`,
            });
            const backupData = await employeesBackup.createBackup();
            const hash = this.verifier.verify(backupData).hash;

            const historyId = await this.backupHistoryService.createHistory({
              operationType: BackupOperationType.BACKUP,
              targetKind: 'csv',
              targetSource: 'employees',
              storageProvider: storageProviderName,
            });

            try {
              const result = await backupService.backup(employeesBackup, {
                label: `auto-after-import-${importSchedule.id}-employees`,
              });
              backupResults.push(result);
              await this.backupHistoryService.completeHistory(historyId, {
                targetKind: 'csv',
                targetSource: 'employees',
                path: result.path,
                sizeBytes: result.sizeBytes,
                hash,
              });
            } catch (backupError) {
              const errorMessage = backupError instanceof Error ? backupError.message : String(backupError);
              await this.backupHistoryService.failHistory(historyId, errorMessage);
              throw backupError;
            }
          }
          if (importSummary.items) {
            const itemsBackup = this.createCsvBackupTarget('items', {
              label: `auto-after-import-${importSchedule.id}`,
            });
            const backupData = await itemsBackup.createBackup();
            const hash = this.verifier.verify(backupData).hash;

            const historyId = await this.backupHistoryService.createHistory({
              operationType: BackupOperationType.BACKUP,
              targetKind: 'csv',
              targetSource: 'items',
              storageProvider: storageProviderName,
            });

            try {
              const result = await backupService.backup(itemsBackup, {
                label: `auto-after-import-${importSchedule.id}-items`,
              });
              backupResults.push(result);
              await this.backupHistoryService.completeHistory(historyId, {
                targetKind: 'csv',
                targetSource: 'items',
                path: result.path,
                sizeBytes: result.sizeBytes,
                hash,
              });
            } catch (backupError) {
              const errorMessage = backupError instanceof Error ? backupError.message : String(backupError);
              await this.backupHistoryService.failHistory(historyId, errorMessage);
              throw backupError;
            }
          }
          const dbUrl = this.getDatabaseUrl();
          const databaseBackup = this.createDatabaseBackupTarget(dbUrl);
          const backupData = await databaseBackup.createBackup();
          const hash = this.verifier.verify(backupData).hash;

          const historyId = await this.backupHistoryService.createHistory({
            operationType: BackupOperationType.BACKUP,
            targetKind: 'database',
            targetSource: 'borrow_return',
            storageProvider: storageProviderName,
          });

          try {
            const result = await backupService.backup(databaseBackup, {
              label: `auto-after-import-${importSchedule.id}-database`,
            });
            backupResults.push(result);
            await this.backupHistoryService.completeHistory(historyId, {
              targetKind: 'database',
              targetSource: 'borrow_return',
              path: result.path,
              sizeBytes: result.sizeBytes,
              hash,
            });
          } catch (backupError) {
            const errorMessage = backupError instanceof Error ? backupError.message : String(backupError);
            await this.backupHistoryService.failHistory(historyId, errorMessage);
            throw backupError;
          }
        }
      } catch (error) {
        this.log.error?.(
          { err: error, taskId: importSchedule.id, target },
          '[CsvImportScheduler] Auto backup failed for target'
        );
        // 個別のバックアップ失敗は続行（他のバックアップは実行）
      }
    }

    this.log.info?.(
      { taskId: importSchedule.id, results: backupResults },
      '[CsvImportScheduler] Auto backup after import completed'
    );
  }
}

