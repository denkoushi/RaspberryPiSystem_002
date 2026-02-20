import { BackupConfigLoader } from '../backup/backup-config.loader.js';
import type { BackupConfig } from '../backup/backup-config.js';
import { StorageProviderFactory } from '../backup/storage-provider-factory.js';
import type { StorageProvider } from '../backup/storage/storage-provider.interface.js';
import { logger } from '../../lib/logger.js';
import { processCsvImportFromTargets } from './csv-import-process.service.js';
import type { CsvImportTarget } from './csv-importer.types.js';
import { CsvDashboardImportService } from '../csv-dashboard/csv-dashboard-import.service.js';
import { CsvImportSourceService } from './csv-import-source.service.js';
import { CsvImportConfigService } from './csv-import-config.service.js';
import { GmailRateLimitedDeferredError } from '../backup/gmail-request-gate.service.js';

export type CsvImportExecutionSummary = {
  employees?: { processed: number; created: number; updated: number };
  items?: { processed: number; created: number; updated: number };
  measuringInstruments?: { processed: number; created: number; updated: number };
  riggingGears?: { processed: number; created: number; updated: number };
  machines?: { processed: number; created: number; updated: number };
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
    onTokenUpdate?: (token: string) => Promise<void>,
    options?: { allowFallbackToLocal?: boolean; gmailAllowWait?: boolean }
  ): Promise<StorageProvider>;
}

type ProcessCsvImportFromTargetsFn = typeof processCsvImportFromTargets;

type CsvImportExecutionDeps = {
  configStore: BackupConfigStore;
  storageProviderFactory: StorageProviderFactoryLike;
  createCsvImportSourceService: () => CsvImportSourceService;
  createCsvDashboardImportService: () => CsvDashboardImportService;
  createCsvImportConfigService: () => CsvImportConfigService;
  processCsvImportFromTargets: ProcessCsvImportFromTargetsFn;
  logger: LoggerLike;
};

export class CsvImportExecutionService {
  private readonly deps: CsvImportExecutionDeps;

  constructor(overrides: Partial<CsvImportExecutionDeps> = {}) {
    this.deps = {
      configStore: {
        load: BackupConfigLoader.load,
        save: BackupConfigLoader.save,
      },
      storageProviderFactory: {
        createFromConfig: (
          config: BackupConfig,
          requestProtocol?: string,
          requestHost?: string,
          onTokenUpdate?: (token: string) => Promise<void>,
          options?: { allowFallbackToLocal?: boolean; gmailAllowWait?: boolean }
        ) => StorageProviderFactory.createFromConfig(config, requestProtocol, requestHost, onTokenUpdate, options),
      },
      createCsvImportSourceService: () => new CsvImportSourceService(),
      createCsvDashboardImportService: () => new CsvDashboardImportService(),
      createCsvImportConfigService: () => new CsvImportConfigService(),
      processCsvImportFromTargets,
      logger,
      ...overrides,
    };
  }

  /**
   * CSVインポートを実行（リトライ機能付き）
   * @param skipRetry 手動実行の場合はtrueを指定してリトライをスキップ
   */
  async execute(params: {
    config: BackupConfig;
    importSchedule: NonNullable<BackupConfig['csvImports']>[0];
    skipRetry?: boolean;
  }): Promise<CsvImportExecutionSummary> {
    const { config, importSchedule, skipRetry = false } = params;

    // プロバイダーを決定（スケジュール固有のプロバイダーまたは全体設定）
    const provider = importSchedule.provider || config.storage.provider;

    if (provider !== 'dropbox' && provider !== 'gmail') {
      throw new Error(`CSV import requires Dropbox or Gmail storage provider, but got: ${provider}`);
    }

    // 手動実行の場合はリトライをスキップして直接実行
    if (skipRetry) {
      return await this.executeAttempt(config, importSchedule, provider, { gmailAllowWait: true });
    }

    // リトライ設定
    const retryConfig = importSchedule.retryConfig || {
      maxRetries: 3,
      retryInterval: 60,
      exponentialBackoff: true,
    };

    // リトライロジックでインポートを実行
    let lastError: Error | undefined;
    for (let attempt = 0; attempt <= retryConfig.maxRetries; attempt++) {
      try {
        return await this.executeAttempt(config, importSchedule, provider, { gmailAllowWait: false });
      } catch (error) {
        // 429クールダウンは「待つ/延期」すべき状態なので、ここで汎用Errorに包まず上位へ伝播させる
        if (error instanceof GmailRateLimitedDeferredError) {
          throw error;
        }
        lastError = error instanceof Error ? error : new Error(String(error));

        if (attempt < retryConfig.maxRetries) {
          const delay = retryConfig.exponentialBackoff
            ? retryConfig.retryInterval * Math.pow(2, attempt)
            : retryConfig.retryInterval;

          this.deps.logger?.warn?.(
            {
              attempt: attempt + 1,
              maxRetries: retryConfig.maxRetries,
              delay,
              error: lastError.message,
            },
            '[CsvImportScheduler] Import attempt failed, retrying'
          );

          await new Promise((resolve) => setTimeout(resolve, delay * 1000));
        }
      }
    }

    // すべてのリトライが失敗した場合
    throw new Error(`CSV import failed after ${retryConfig.maxRetries + 1} attempts: ${lastError?.message}`);
  }

  /**
   * CSVインポートの1回の試行を実行
   */
  private async executeAttempt(
    config: BackupConfig,
    importSchedule: NonNullable<BackupConfig['csvImports']>[0],
    provider: 'dropbox' | 'gmail',
    opts: { gmailAllowWait: boolean }
  ): Promise<CsvImportExecutionSummary> {
    // ストレージプロバイダーを作成（Factoryパターンを使用）
    const protocol = 'http'; // スケジューラー内ではプロトコルは不要
    const host = 'localhost:8080'; // スケジューラー内ではホストは不要

    // トークン更新コールバック（provider別名前空間へ保存）
    const onTokenUpdate = async (token: string) => {
      const latestConfig = await this.deps.configStore.load();
      // NOTE: global provider(dropbox)運用でも、CSV import provider(gmail)のトークン更新を保存できるようにする
      if (provider === 'gmail') {
        latestConfig.storage.options = {
          ...(latestConfig.storage.options || {}),
          gmail: {
            ...latestConfig.storage.options?.gmail,
            accessToken: token,
          },
        };
      } else if (provider === 'dropbox') {
        latestConfig.storage.options = {
          ...(latestConfig.storage.options || {}),
          dropbox: {
            ...latestConfig.storage.options?.dropbox,
            accessToken: token,
          },
        };
      }
      await this.deps.configStore.save(latestConfig);
      this.deps.logger?.info?.({ provider }, '[CsvImportScheduler] Access token updated');
    };

    // StorageProviderFactoryを使用してプロバイダーを作成
    const storageProvider = await this.deps.storageProviderFactory.createFromConfig(
      {
        ...config,
        storage: {
          ...config.storage,
          provider,
        },
      },
      protocol,
      host,
      onTokenUpdate,
      { allowFallbackToLocal: provider !== 'gmail', gmailAllowWait: opts.gmailAllowWait }
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

    const configService = this.deps.createCsvImportConfigService();
    const filteredTargets: CsvImportTarget[] = [];
    for (const target of targets) {
      if (target.type === 'csvDashboards') {
        filteredTargets.push(target);
        continue;
      }
      const config = await configService.getEffectiveConfig(target.type);
      if (config && !config.allowedScheduledImport) {
        this.deps.logger?.warn?.(
          { type: target.type },
          '[CsvImportScheduler] Scheduled import disabled by config, skipping target'
        );
        continue;
      }
      filteredTargets.push(target);
    }

    if (filteredTargets.length === 0) {
      this.deps.logger?.warn?.({}, '[CsvImportScheduler] All targets are skipped by config');
      return {};
    }

    targets = filteredTargets;

    // CSVダッシュボード用のターゲットと通常のインポート用のターゲットを分離
    const csvDashboardTargets = targets.filter((t) => t.type === 'csvDashboards');
    const importTargets = targets.filter((t) => t.type !== 'csvDashboards');

    // CSVファイルをダウンロード
    const fileMap = new Map<string, Buffer>();
    let csvDashboardResults: Record<string, { rowsProcessed: number; rowsAdded: number; rowsSkipped: number }> = {};
    const csvImportSourceService = this.deps.createCsvImportSourceService();
    // 1回の実行中だけ件名パターン取得をキャッシュ（挙動は不変、DB往復を削減）
    const subjectPatternCache = new Map<string, string[]>();

    // CSVダッシュボード用の処理
    if (csvDashboardTargets.length > 0) {
      const csvDashboardImportService = this.deps.createCsvDashboardImportService();
      const dashboardIds = csvDashboardTargets.map((t) => t.source);
      csvDashboardResults = await csvDashboardImportService.ingestTargets({
        provider,
        storageProvider,
        dashboardIds,
      });
    }

    // 通常のCSVインポート処理
    if (importTargets.length > 0) {
      for (const target of importTargets) {
        const { buffer, resolvedSource } = await csvImportSourceService.downloadMasterCsv({
          target,
          provider,
          storageProvider,
          patternCache: subjectPatternCache,
          logger: this.deps.logger,
        });

        fileMap.set(target.type, buffer);
        this.deps.logger?.info?.(
          { type: target.type, source: resolvedSource, size: buffer.length, provider },
          `[CsvImportScheduler] ${target.type} CSV downloaded`
        );
      }

      // CSVインポートを実行
      const logWrapper = {
        info: (obj: unknown, msg: string) => {
          this.deps.logger?.info?.(obj, msg);
        },
        error: (obj: unknown, msg: string) => {
          this.deps.logger?.error?.(obj, msg);
        },
      };

      const { summary } = await this.deps.processCsvImportFromTargets(
        importTargets,
        fileMap,
        importSchedule.replaceExisting ?? false,
        logWrapper
      );

      this.deps.logger?.info?.({ taskId: importSchedule.id, summary }, '[CsvImportScheduler] CSV import completed');

      // CSVダッシュボードの結果も含めて返す
      return { ...summary, csvDashboards: csvDashboardResults };
    }

    // CSVダッシュボードのみの場合
    return { csvDashboards: csvDashboardResults };
  }
}

