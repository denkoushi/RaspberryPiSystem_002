import type { FastifyInstance } from 'fastify';

import { authorizeRoles } from '../../lib/auth.js';
import { ApiError } from '../../lib/errors.js';
import { logger } from '../../lib/logger.js';
import { BackupConfigLoader } from '../../services/backup/backup-config.loader.js';
import type { BackupConfig } from '../../services/backup/backup-config.js';
import { planDropboxSelectivePurge } from '../../services/backup/dropbox-backup-maintenance.js';
import { BackupService } from '../../services/backup/backup.service.js';
import { StorageProviderFactory } from '../../services/backup/storage-provider-factory.js';

type LegacyStorageOptions = NonNullable<BackupConfig['storage']['options']> & {
  accessToken?: string;
  refreshToken?: string;
  appKey?: string;
  appSecret?: string;
};

export async function registerBackupPurgeRoutes(app: FastifyInstance): Promise<void> {
  const mustBeAdmin = authorizeRoles('ADMIN');

  // Dropbox /backups 配下の全削除（メンテナンス用、強い確認必須）
  app.post('/backup/dropbox/purge', {
    preHandler: [mustBeAdmin],
    schema: {
      body: {
        type: 'object',
        properties: {
          confirmText: { type: 'string' },
        },
        required: ['confirmText'],
      },
    },
  }, async (request, reply) => {
    const body = request.body as { confirmText: string };

    // 強い確認: 正確な確認テキストを要求
    const REQUIRED_CONFIRM_TEXT = 'DELETE_ALL_UNDER_/backups';
    if (body.confirmText !== REQUIRED_CONFIRM_TEXT) {
      throw new ApiError(400, `Invalid confirmation text. Must be exactly: ${REQUIRED_CONFIRM_TEXT}`);
    }

    const config = await BackupConfigLoader.load();

    // Dropboxプロバイダーが設定されているか確認
    if (config.storage.provider !== 'dropbox') {
      throw new ApiError(400, 'Dropbox storage provider is not configured');
    }

    const basePath = (config.storage.options?.basePath as string | undefined) || '/backups';

    // basePathが/backupsでない場合は安全のため拒否
    if (basePath !== '/backups') {
      throw new ApiError(400, `Unexpected basePath: ${basePath}. Only /backups is allowed for purge operation.`);
    }

    const protocol = Array.isArray(request.headers['x-forwarded-proto'])
      ? request.headers['x-forwarded-proto'][0]
      : (request.headers['x-forwarded-proto'] || request.protocol || 'http');
    const host = Array.isArray(request.headers.host)
      ? request.headers.host[0]
      : (request.headers.host || 'localhost:8080');

    // トークン更新コールバック（Dropbox専用: options.dropbox.accessToken へ保存）
    const onTokenUpdate = async (newToken: string) => {
      const latestConfig = await BackupConfigLoader.load();
      (latestConfig.storage.options ??= {});
      const opts = latestConfig.storage.options as LegacyStorageOptions;
      opts.dropbox = { ...(opts.dropbox ?? {}), accessToken: newToken };
      // 後方互換（旧キー）も更新しておく
      opts.accessToken = newToken;
      await BackupConfigLoader.save(latestConfig);
    };

    try {
      // Dropboxストレージプロバイダーを作成
      const dropboxProvider = await StorageProviderFactory.createFromConfig(config, protocol, host, onTokenUpdate);
      const backupService = new BackupService(dropboxProvider);

      // まず一覧を取得して確認
      logger?.info({ basePath }, '[BackupRoute] Listing Dropbox backups before purge');
      const backups = await backupService.listBackups({ prefix: '' });

      logger?.info({ count: backups.length, basePath }, '[BackupRoute] Found backups to delete');

      // 各バックアップを削除
      let deletedCount = 0;
      let failedCount = 0;
      const errors: string[] = [];

      for (const backup of backups) {
        if (!backup.path) continue;
        try {
          await backupService.deleteBackup(backup.path);
          deletedCount++;
          logger?.info({ path: backup.path }, '[BackupRoute] Deleted backup');
        } catch (error) {
          failedCount++;
          const errorMessage = error instanceof Error ? error.message : 'Unknown error';
          errors.push(`${backup.path}: ${errorMessage}`);
          logger?.error({ err: error, path: backup.path }, '[BackupRoute] Failed to delete backup');
        }
      }

      return reply.status(200).send({
        success: true,
        deletedCount,
        failedCount,
        totalCount: backups.length,
        errors: errors.length > 0 ? errors : undefined,
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      logger?.error({ err: error }, '[BackupRoute] Failed to purge Dropbox backups');
      throw new ApiError(500, `Failed to purge Dropbox backups: ${errorMessage}`);
    }
  });

  // Dropbox /backups 配下の選択削除（最新DBのみ保持）
  app.post('/backup/dropbox/purge-selective', {
    preHandler: [mustBeAdmin],
    schema: {
      body: {
        type: 'object',
        properties: {
          confirmText: { type: 'string' },
          dryRun: { type: 'boolean' },
          keepLatestDatabaseCount: { type: 'number' },
        },
        required: ['confirmText'],
      },
    },
  }, async (request, reply) => {
    const body = request.body as { confirmText: string; dryRun?: boolean; keepLatestDatabaseCount?: number };

    const REQUIRED_CONFIRM_TEXT = 'DELETE_ALL_UNDER_/backups_EXCEPT_LATEST_DB';
    if (body.confirmText !== REQUIRED_CONFIRM_TEXT) {
      throw new ApiError(400, `Invalid confirmation text. Must be exactly: ${REQUIRED_CONFIRM_TEXT}`);
    }

    const keepLatestDatabaseCount = body.keepLatestDatabaseCount ?? 1;
    if (!Number.isFinite(keepLatestDatabaseCount) || keepLatestDatabaseCount < 1) {
      throw new ApiError(400, 'keepLatestDatabaseCount must be >= 1');
    }

    const config = await BackupConfigLoader.load();

    if (config.storage.provider !== 'dropbox') {
      throw new ApiError(400, 'Dropbox storage provider is not configured');
    }

    const basePath = (config.storage.options?.basePath as string | undefined) || '/backups';
    if (basePath !== '/backups') {
      throw new ApiError(400, `Unexpected basePath: ${basePath}. Only /backups is allowed for purge operation.`);
    }

    const protocol = Array.isArray(request.headers['x-forwarded-proto'])
      ? request.headers['x-forwarded-proto'][0]
      : (request.headers['x-forwarded-proto'] || request.protocol || 'http');
    const host = Array.isArray(request.headers.host)
      ? request.headers.host[0]
      : (request.headers.host || 'localhost:8080');

    const onTokenUpdate = async (newToken: string) => {
      const latestConfig = await BackupConfigLoader.load();
      (latestConfig.storage.options ??= {});
      const opts = latestConfig.storage.options as LegacyStorageOptions;
      opts.dropbox = { ...(opts.dropbox ?? {}), accessToken: newToken };
      opts.accessToken = newToken;
      await BackupConfigLoader.save(latestConfig);
    };

    const dropboxProvider = await StorageProviderFactory.createFromConfig(config, protocol, host, onTokenUpdate);
    const backupService = new BackupService(dropboxProvider);

    logger?.info({ basePath }, '[BackupRoute] Listing Dropbox backups before selective purge');
    const backups = await backupService.listBackups({ prefix: '' });
    const plan = planDropboxSelectivePurge(backups, keepLatestDatabaseCount);
    if (plan.reason === 'no_database_backups') {
      throw new ApiError(400, 'No database backups found under /backups/database. Aborting purge for safety.');
    }

    const deletePaths = plan.remove.map((backup) => backup.path).filter((path): path is string => !!path);
    const keepPaths = plan.keep.map((backup) => backup.path).filter((path): path is string => !!path);
    const skippedMissingPathCount = plan.skippedMissingPath.length;
    const deleteSizeBytes = plan.remove.reduce((total, backup) => total + (backup.sizeBytes ?? 0), 0);

    const dryRun = body.dryRun !== false;
    if (dryRun) {
      return reply.status(200).send({
        success: true,
        dryRun: true,
        keepLatestDatabaseCount,
        keepCount: keepPaths.length,
        deleteCount: deletePaths.length,
        skippedMissingPathCount,
        deleteSizeBytes,
        keepSample: keepPaths.slice(0, 5),
        deleteSample: deletePaths.slice(0, 10),
      });
    }

    let deletedCount = 0;
    let failedCount = 0;
    const errors: string[] = [];
    for (const path of deletePaths) {
      try {
        await backupService.deleteBackup(path);
        deletedCount++;
        logger?.info({ path }, '[BackupRoute] Deleted backup (selective purge)');
      } catch (error) {
        failedCount++;
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        errors.push(`${path}: ${errorMessage}`);
        logger?.error({ err: error, path }, '[BackupRoute] Failed to delete backup (selective purge)');
      }
    }

    return reply.status(200).send({
      success: failedCount === 0,
      dryRun: false,
      keepLatestDatabaseCount,
      keepCount: keepPaths.length,
      deleteCount: deletePaths.length,
      deletedCount,
      failedCount,
      skippedMissingPathCount,
      deleteSizeBytes,
      errors: errors.length > 0 ? errors : undefined,
    });
  });
}
