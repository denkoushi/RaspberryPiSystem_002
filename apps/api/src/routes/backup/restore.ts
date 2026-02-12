import { BackupOperationType } from '@prisma/client';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import { authorizeRoles } from '../../lib/auth.js';
import { BackupService } from '../../services/backup/backup.service.js';
import { LocalStorageProvider } from '../../services/backup/storage/local-storage.provider.js';
import { BackupConfigLoader } from '../../services/backup/backup-config.loader.js';
import { BackupTargetFactory } from '../../services/backup/backup-target-factory.js';
import { StorageProviderFactory } from '../../services/backup/storage-provider-factory.js';
import type { BackupKind } from '../../services/backup/backup-types.js';
import { BackupHistoryService } from '../../services/backup/backup-history.service.js';
import { logger } from '../../lib/logger.js';
import { runPreRestoreBackup } from '../../services/backup/pre-restore-backup.service.js';

const restoreRequestSchema = z.object({
  backupPath: z.string(),
  destination: z.string().optional(),
  storage: z.object({
    provider: z.enum(['local', 'dropbox']),
    options: z.record(z.unknown()).optional(),
  }).optional(),
  preBackup: z.boolean().optional(),
});

export async function registerBackupRestoreRoutes(app: FastifyInstance): Promise<void> {
  const mustBeAdmin = authorizeRoles('ADMIN');

  // バックアップの復元
  app.post('/backup/restore', {
    preHandler: [mustBeAdmin],
    schema: {
      body: {
        type: 'object',
        properties: {
          backupPath: { type: 'string' },
          destination: { type: 'string' },
          storage: {
            type: 'object',
            properties: {
              provider: { type: 'string', enum: ['local', 'dropbox'] },
              options: { type: 'object' },
            },
          },
        },
        required: ['backupPath'],
      },
    },
  }, async (request, reply) => {
    const body = restoreRequestSchema.parse(request.body ?? {});

    // ストレージプロバイダーを作成（Factoryパターンを使用）
    const protocol = request.headers['x-forwarded-proto'] || request.protocol || 'http';
    const host = request.headers.host || 'localhost:8080';
    const storageProvider = body.storage
      ? StorageProviderFactory.create({
        provider: body.storage.provider,
        accessToken: body.storage.options?.accessToken as string | undefined,
        basePath: body.storage.options?.basePath as string | undefined,
        refreshToken: body.storage.options?.refreshToken as string | undefined,
        appKey: body.storage.options?.appKey as string | undefined,
        appSecret: body.storage.options?.appSecret as string | undefined,
        redirectUri: `${protocol}://${host}/api/backup/oauth/callback`,
      })
      : new LocalStorageProvider();

    const backupService = new BackupService(storageProvider);
    const historyService = new BackupHistoryService();

    // バックアップパスからtargetKindとtargetSourceを推測
    const backupPathParts = body.backupPath.split('/');
    const targetKind = backupPathParts[0] || 'file'; // パスの最初の部分が種類（database, csv, file等）
    const targetSource = backupPathParts[backupPathParts.length - 1] || body.backupPath;

    // リストア履歴を作成
    const historyId = await historyService.createHistory({
      operationType: BackupOperationType.RESTORE,
      targetKind,
      targetSource,
      backupPath: body.backupPath,
      storageProvider: body.storage?.provider || 'local',
    });

    try {
      const preBackup = body.preBackup ?? (targetKind === 'database');
      if (preBackup) {
        await runPreRestoreBackup({
          config: await BackupConfigLoader.load(),
          targetKind: targetKind as BackupKind,
          targetSource,
          protocol: Array.isArray(request.headers['x-forwarded-proto'])
            ? request.headers['x-forwarded-proto'][0]
            : (request.headers['x-forwarded-proto'] || request.protocol || 'http'),
          host: Array.isArray(request.headers.host)
            ? request.headers.host[0]
            : (request.headers.host || 'localhost:8080'),
        });
      }

      // バックアップデータをダウンロード
      const backupData = await storageProvider.download(body.backupPath);

      // 設定ファイルを読み込む
      const config = await BackupConfigLoader.load();

      // バックアップターゲットを作成（Factoryパターンを使用）
      const target = BackupTargetFactory.createFromConfig(config, targetKind as BackupKind, targetSource);

      // ターゲットがrestoreメソッドを実装している場合はそれを使用
      if (target.restore) {
        logger?.info({ targetKind, targetSource, backupPath: body.backupPath }, '[BackupRoute] Restoring using target restore method');
        const result = await target.restore(backupData, {
          destination: body.destination,
          overwrite: true,
        });

        // リストア履歴を完了として更新
        await historyService.completeHistory(historyId, {
          targetKind,
          targetSource,
          path: body.backupPath,
        });

        return reply.status(200).send({
          success: result.success,
          timestamp: result.timestamp,
          historyId,
        });
      } else {
        // restoreメソッドが実装されていない場合は通常の処理を実行
        const result = await backupService.restore(body.backupPath, {
          destination: body.destination,
        });

        // リストア履歴を完了として更新
        await historyService.completeHistory(historyId, {
          targetKind,
          targetSource,
          path: body.backupPath,
        });

        return reply.status(200).send({
          success: result.success,
          timestamp: result.timestamp,
          historyId,
        });
      }
    } catch (error) {
      // リストア履歴を失敗として更新
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      await historyService.failHistory(historyId, errorMessage);
      throw error;
    }
  });

  // リストアのドライラン（破壊的操作なし）
  app.post('/backup/restore/dry-run', {
    preHandler: [mustBeAdmin],
    schema: {
      body: {
        type: 'object',
        properties: {
          backupPath: { type: 'string' },
          targetKind: { type: 'string', enum: ['database', 'csv', 'image', 'file', 'directory', 'client-file', 'client-directory'] },
          storage: {
            type: 'object',
            properties: {
              provider: { type: 'string', enum: ['local', 'dropbox'] },
              options: { type: 'object' },
            },
          },
        },
        required: ['backupPath'],
      },
    },
  }, async (request, reply) => {
    const body = request.body as {
      backupPath: string;
      targetKind?: BackupKind;
      storage?: {
        provider: 'local' | 'dropbox';
        options?: Record<string, unknown>;
      };
    };

    const protocol = request.headers['x-forwarded-proto'] || request.protocol || 'http';
    const host = request.headers.host || 'localhost:8080';
    const storageProvider = body.storage
      ? StorageProviderFactory.create({
        provider: body.storage.provider,
        accessToken: body.storage.options?.accessToken as string | undefined,
        basePath: body.storage.options?.basePath as string | undefined,
        refreshToken: body.storage.options?.refreshToken as string | undefined,
        appKey: body.storage.options?.appKey as string | undefined,
        appSecret: body.storage.options?.appSecret as string | undefined,
        redirectUri: `${protocol}://${host}/api/backup/oauth/callback`,
      })
      : new LocalStorageProvider();

    const backupService = new BackupService(storageProvider);
    const config = await BackupConfigLoader.load();
    const basePath = config.storage.options?.basePath as string | undefined;

    let normalizedBackupPath = body.backupPath;
    if (body.storage?.provider === 'dropbox' && basePath && normalizedBackupPath.startsWith(basePath)) {
      normalizedBackupPath = normalizedBackupPath.slice(basePath.length);
      if (normalizedBackupPath.startsWith('/')) {
        normalizedBackupPath = normalizedBackupPath.slice(1);
      }
    }

    const pathParts = normalizedBackupPath.split('/');
    const targetKind = body.targetKind || (pathParts[0] as BackupKind) || 'file';
    let targetSource = pathParts[pathParts.length - 1] || normalizedBackupPath;
    if (targetKind === 'csv' && targetSource.endsWith('.csv')) {
      targetSource = targetSource.replace(/\.csv$/, '');
    }
    if (targetKind === 'database') {
      if (targetSource.endsWith('.sql.gz')) {
        targetSource = targetSource.replace(/\.sql\.gz$/, '');
      } else if (targetSource.endsWith('.sql')) {
        targetSource = targetSource.replace(/\.sql$/, '');
      }
    }

    const list = await backupService.listBackups({ prefix: targetKind });
    const exists = list.find((entry) => {
      if (!entry.path) return false;
      if (entry.path === body.backupPath) return true;
      if (entry.path.endsWith(`/${normalizedBackupPath}`)) return true;
      return false;
    });

    return reply.status(200).send({
      backupPath: body.backupPath,
      normalizedBackupPath,
      targetKind,
      targetSource,
      storageProvider: body.storage?.provider ?? 'local',
      exists: !!exists,
      sizeBytes: exists?.sizeBytes ?? null,
      modifiedAt: exists?.modifiedAt ?? null,
      preBackupDefault: targetKind === 'database',
    });
  });
}
