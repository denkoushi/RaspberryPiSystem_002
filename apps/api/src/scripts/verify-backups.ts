import { BackupConfigLoader } from '../services/backup/backup-config.loader.js';
import { BackupVerifier } from '../services/backup/backup-verifier.js';
import { StorageProviderFactory } from '../services/backup/storage-provider-factory.js';
import { BackupService } from '../services/backup/backup.service.js';
import { prisma } from '../lib/prisma.js';
import type { BackupConfig } from '../services/backup/backup-config.js';
import type { BackupTargetInfo } from '../services/backup/backup-types.js';
import { logger } from '../lib/logger.js';
import { BackupOperationType, BackupStatus } from '@prisma/client';

type VerifyMode = 'monthly' | 'quarterly';

type TargetCheckResult = {
  kind: string;
  source: string;
  latestBackupAt?: string;
  latestBackupPath?: string;
  storageProvider?: string;
  issues: string[];
  warnings: string[];
};

type VerifyReport = {
  mode: VerifyMode;
  startedAt: string;
  completedAt?: string;
  healthStatus?: string;
  healthIssues?: Array<{ type: string; severity: string; message: string }>;
  results: TargetCheckResult[];
  exitCode?: number;
};

const DEFAULT_MAX_AGE_DAYS_MONTHLY = 35;
const DEFAULT_MAX_AGE_DAYS_QUARTERLY = 110;
const DEFAULT_MAX_DOWNLOAD_MB = 50;

const getArg = (name: string, defaultValue?: string): string | undefined => {
  const prefix = `${name}=`;
  const direct = process.argv.find((arg) => arg === name);
  if (direct) {
    const idx = process.argv.indexOf(direct);
    return process.argv[idx + 1] ?? defaultValue;
  }
  const value = process.argv.find((arg) => arg.startsWith(prefix));
  if (!value) return defaultValue;
  return value.slice(prefix.length) || defaultValue;
};

const parseNumber = (value: string | undefined, fallback: number): number => {
  if (!value) return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const stripDropboxBasePath = (path: string, basePath?: string): string => {
  if (!basePath) return path;
  const normalizedBase = basePath.replace(/\/+$/, '');
  if (path.startsWith(normalizedBase)) {
    const stripped = path.slice(normalizedBase.length);
    return stripped.startsWith('/') ? stripped.slice(1) : stripped;
  }
  return path.startsWith('/') ? path.slice(1) : path;
};

const pickStorageProviderConfig = (config: BackupConfig, provider: 'local' | 'dropbox'): BackupConfig => {
  return {
    ...config,
    storage: {
      ...config.storage,
      provider
    }
  };
};

const shouldDownload = (sizeBytes: number | null | undefined, maxDownloadBytes: number): boolean => {
  if (!sizeBytes || sizeBytes <= 0) return false;
  return sizeBytes <= maxDownloadBytes;
};

const buildTargetInfo = (kind: string, source: string): BackupTargetInfo => ({
  type: kind as BackupTargetInfo['type'],
  source
});

const verifyTargetBackup = async (params: {
  config: BackupConfig;
  mode: VerifyMode;
  maxAgeDays: number;
  maxDownloadBytes: number;
  target: BackupConfig['targets'][number];
}): Promise<TargetCheckResult> => {
  const { config, mode, maxAgeDays, maxDownloadBytes, target } = params;
  const issues: string[] = [];
  const warnings: string[] = [];

  const latestHistory = await prisma.backupHistory.findFirst({
    where: {
      operationType: BackupOperationType.BACKUP,
      targetKind: target.kind,
      targetSource: target.source,
      status: BackupStatus.COMPLETED
    },
    orderBy: { startedAt: 'desc' }
  });

  if (!latestHistory) {
    issues.push('最新のバックアップ履歴が見つかりません');
    return {
      kind: target.kind,
      source: target.source,
      issues,
      warnings
    };
  }

  const now = Date.now();
  const ageDays = (now - latestHistory.startedAt.getTime()) / (1000 * 60 * 60 * 24);
  if (ageDays > maxAgeDays) {
    issues.push(`最新バックアップが古すぎます（${ageDays.toFixed(1)}日経過）`);
  }

  if (!latestHistory.backupPath) {
    issues.push('バックアップパスが履歴に記録されていません');
    return {
      kind: target.kind,
      source: target.source,
      latestBackupAt: latestHistory.startedAt.toISOString(),
      storageProvider: latestHistory.storageProvider,
      issues,
      warnings
    };
  }

  const provider = (latestHistory.storageProvider === 'dropbox' ? 'dropbox' : 'local') as 'local' | 'dropbox';
  const providerConfig = pickStorageProviderConfig(config, provider);
  const storageProvider = await StorageProviderFactory.createFromConfig(
    providerConfig,
    undefined,
    undefined,
    async () => {},
    { allowFallbackToLocal: false }
  );
  const backupService = new BackupService(storageProvider);
  const list = await backupService.listBackups({ prefix: target.kind });
  const basePath = config.storage.options?.basePath as string | undefined;

  const exists = list.find((entry) => {
    if (!entry.path) return false;
    if (entry.path === latestHistory.backupPath) return true;
    if (entry.path.endsWith(`/${latestHistory.backupPath}`)) return true;
    if (provider === 'dropbox') {
      const stripped = stripDropboxBasePath(entry.path, basePath);
      return stripped === latestHistory.backupPath;
    }
    return false;
  });

  if (!exists) {
    issues.push('バックアップファイルがストレージ上に見つかりません');
  }

  if (mode === 'quarterly' && exists) {
    if (latestHistory.sizeBytes && exists.sizeBytes && latestHistory.sizeBytes !== exists.sizeBytes) {
      issues.push(`サイズ不一致（履歴=${latestHistory.sizeBytes}, ストレージ=${exists.sizeBytes}）`);
    }

    if (shouldDownload(exists.sizeBytes, maxDownloadBytes)) {
      try {
        const data = await storageProvider.download(latestHistory.backupPath);
        const verification = BackupVerifier.verify(
          data,
          latestHistory.sizeBytes ?? undefined,
          latestHistory.hash ?? undefined
        );
        if (!verification.valid) {
          issues.push(...verification.errors.map((e) => `整合性検証失敗: ${e}`));
        }
        const formatVerification = BackupVerifier.verifyFormat(data, buildTargetInfo(target.kind, target.source));
        if (!formatVerification.valid) {
          warnings.push(...formatVerification.errors.map((e) => `形式検証警告: ${e}`));
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        issues.push(`検証用ダウンロードに失敗しました: ${message}`);
      }
    } else {
      warnings.push('ファイルサイズが大きいためダウンロード検証をスキップしました');
    }
  }

  return {
    kind: target.kind,
    source: target.source,
    latestBackupAt: latestHistory.startedAt.toISOString(),
    latestBackupPath: latestHistory.backupPath,
    storageProvider: latestHistory.storageProvider,
    issues,
    warnings
  };
};

const run = async (): Promise<void> => {
  const mode = (getArg('--mode', 'monthly') ?? 'monthly') as VerifyMode;
  const maxAgeDays = parseNumber(
    getArg('--max-age-days'),
    mode === 'monthly' ? DEFAULT_MAX_AGE_DAYS_MONTHLY : DEFAULT_MAX_AGE_DAYS_QUARTERLY
  );
  const maxDownloadMb = parseNumber(getArg('--max-download-mb'), DEFAULT_MAX_DOWNLOAD_MB);
  const maxDownloadBytes = maxDownloadMb * 1024 * 1024;

  const report: VerifyReport = {
    mode,
    startedAt: new Date().toISOString(),
    results: []
  };

  const config = await BackupConfigLoader.load();
  const health = await BackupConfigLoader.checkHealth();
  report.healthStatus = health.status;
  report.healthIssues = health.issues.map((issue) => ({
    type: issue.type,
    severity: issue.severity,
    message: issue.message
  }));

  const targets = config.targets.filter((target) => target.enabled !== false);
  for (const target of targets) {
    const result = await verifyTargetBackup({
      config,
      mode,
      maxAgeDays,
      maxDownloadBytes,
      target
    });
    report.results.push(result);
  }

  const failed = report.results.some((result) => result.issues.length > 0);
  report.completedAt = new Date().toISOString();
  report.exitCode = failed ? 1 : 0;

  const output = JSON.stringify(report, null, 2);
  if (failed) {
    logger?.error({ report }, '[BackupVerify] Backup verification failed');
    // eslint-disable-next-line no-console
    console.error(output);
    process.exit(1);
  }

  logger?.info({ report }, '[BackupVerify] Backup verification completed');
  // eslint-disable-next-line no-console
  console.log(output);
};

run().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  logger?.error({ err: message }, '[BackupVerify] Unexpected error');
  // eslint-disable-next-line no-console
  console.error(`バックアップ検証で予期しないエラーが発生しました: ${message}`);
  process.exit(2);
});
