import { BackupOperationType } from '@prisma/client';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import { authorizeRoles } from '../../lib/auth.js';
import { ApiError } from '../../lib/errors.js';
import { logger } from '../../lib/logger.js';
import { BackupConfigLoader } from '../../services/backup/backup-config.loader.js';
import type { BackupConfig } from '../../services/backup/backup-config.js';
import { BackupHistoryService } from '../../services/backup/backup-history.service.js';
import { BackupTargetFactory } from '../../services/backup/backup-target-factory.js';
import type { BackupKind } from '../../services/backup/backup-types.js';
import { BackupService } from '../../services/backup/backup.service.js';
import { StorageProviderFactory } from '../../services/backup/storage-provider-factory.js';
import { runPreRestoreBackup } from '../../services/backup/pre-restore-backup.service.js';

type LegacyStorageOptions = NonNullable<BackupConfig['storage']['options']> & {
  accessToken?: string;
  refreshToken?: string;
  appKey?: string;
  appSecret?: string;
};

const restoreFromDropboxRequestSchema = z.object({
  backupPath: z.string().min(1, 'バックアップパスは必須です'),
  targetKind: z.enum(['database', 'csv', 'image']).optional(), // リストア対象の種類
  verifyIntegrity: z.boolean().optional().default(true), // 整合性検証を実行するか
  preBackup: z.boolean().optional(), // リストア前の事前バックアップ
  expectedSize: z.number().optional(), // 期待されるファイルサイズ
  expectedHash: z.string().optional(), // 期待されるハッシュ値（SHA256）
});

export async function registerBackupRestoreDropboxRoutes(
  app: FastifyInstance
): Promise<void> {
  const mustBeAdmin = authorizeRoles('ADMIN');

  // Dropboxからバックアップをリストア
  app.post('/backup/restore/from-dropbox', {
    preHandler: [mustBeAdmin],
    schema: {
      body: {
        type: 'object',
        properties: {
          backupPath: { type: 'string' },
          targetKind: { type: 'string', enum: ['database', 'csv', 'image'] },
          verifyIntegrity: { type: 'boolean' },
          preBackup: { type: 'boolean' },
          expectedSize: { type: 'number' },
          expectedHash: { type: 'string' },
        },
        required: ['backupPath'],
      },
    },
  }, async (request, reply) => {
    const body = restoreFromDropboxRequestSchema.parse(request.body ?? {});

    // 設定ファイルからDropboxの認証情報を読み込む
    const config = await BackupConfigLoader.load();
    if (config.storage.provider !== 'dropbox') {
      throw new ApiError(400, 'Dropbox storage provider is not configured');
    }

    const accessToken = config.storage.options?.accessToken as string | undefined;
    if (!accessToken) {
      throw new ApiError(400, 'Dropbox access token is required in config file');
    }

    // ストレージプロバイダーを作成（Factoryパターンを使用）
    const protocol = Array.isArray(request.headers['x-forwarded-proto'])
      ? request.headers['x-forwarded-proto'][0]
      : (request.headers['x-forwarded-proto'] || request.protocol || 'http');
    const host = Array.isArray(request.headers.host)
      ? request.headers.host[0]
      : (request.headers.host || 'localhost:8080');

    // トークン更新コールバック
    const onTokenUpdate = async (newToken: string) => {
      const latest = await BackupConfigLoader.load();
      (latest.storage.options ??= {});
      // 旧キー（現行実装が参照している可能性あり）
      const legacyOpts = latest.storage.options as LegacyStorageOptions;
      legacyOpts.accessToken = newToken;
      // 新構造も更新
      legacyOpts.dropbox = { ...(legacyOpts.dropbox ?? {}), accessToken: newToken };
      await BackupConfigLoader.save(latest);
    };

    // Dropboxストレージプロバイダーを作成（Factoryパターンを使用）
    const dropboxProvider = await StorageProviderFactory.createFromConfig(config, protocol, host, onTokenUpdate);

    const backupService = new BackupService(dropboxProvider);
    const historyService = new BackupHistoryService();

    // バックアップパスからtargetKindとtargetSourceを推測
    // basePathが含まれている場合は削除（例: /backups/csv/... -> csv/...）
    const basePath = config.storage.options?.basePath as string | undefined;
    let normalizedBackupPath = body.backupPath;
    if (basePath && normalizedBackupPath.startsWith(basePath)) {
      normalizedBackupPath = normalizedBackupPath.slice(basePath.length);
      // 先頭のスラッシュを削除
      if (normalizedBackupPath.startsWith('/')) {
        normalizedBackupPath = normalizedBackupPath.slice(1);
      }
    }

    const backupPathParts = normalizedBackupPath.split('/');
    const targetKind = body.targetKind || backupPathParts[0] || 'file';
    let targetSource = backupPathParts[backupPathParts.length - 1] || normalizedBackupPath;

    logger?.info({ targetKind, targetSource, backupPathParts }, '[BackupRoute] Extracted targetKind and targetSource');

    // CSVの場合はファイル名から拡張子を削除（employees.csv -> employees）
    if (targetKind === 'csv' && targetSource.endsWith('.csv')) {
      targetSource = targetSource.replace(/\.csv$/, '');
    }

    // データベースバックアップの場合は拡張子を削除（borrow_return.sql.gz -> borrow_return）
    if (targetKind === 'database') {
      if (targetSource.endsWith('.sql.gz')) {
        targetSource = targetSource.replace(/\.sql\.gz$/, '');
        logger?.info({ original: backupPathParts[backupPathParts.length - 1], cleaned: targetSource }, '[BackupRoute] Removed .sql.gz extension from targetSource');
      } else if (targetSource.endsWith('.sql')) {
        targetSource = targetSource.replace(/\.sql$/, '');
        logger?.info({ original: backupPathParts[backupPathParts.length - 1], cleaned: targetSource }, '[BackupRoute] Removed .sql extension from targetSource');
      }
    }

    const preBackup = body.preBackup ?? (targetKind === 'database');
    if (preBackup) {
      await runPreRestoreBackup({
        config,
        targetKind: targetKind as BackupKind,
        targetSource,
        protocol,
        host,
      });
    }

    // データベースバックアップの場合は拡張子を処理
    // 既存のバックアップファイル（拡張子なし）との互換性のため、拡張子がない場合は.sql.gzを追加
    let actualBackupPath = normalizedBackupPath;
    if (targetKind === 'database' && !normalizedBackupPath.endsWith('.sql.gz') && !normalizedBackupPath.endsWith('.sql')) {
      // 拡張子がない場合は.sql.gzを追加（新しいバックアップファイル形式）
      actualBackupPath = `${normalizedBackupPath}.sql.gz`;
    }

    // リストア履歴を作成（NOTE: databaseリストアはDB自体を上書きするため、後段で履歴が消える可能性がある）
    logger?.info(
      { targetKind, targetSource, normalizedBackupPath, actualBackupPath },
      '[BackupRoute] Creating restore history (from-dropbox)'
    );
    const preHistoryId = await historyService.createHistory({
      operationType: BackupOperationType.RESTORE,
      targetKind,
      targetSource,
      backupPath: normalizedBackupPath,
      storageProvider: 'dropbox',
    });
    logger?.info({ historyId: preHistoryId }, '[BackupRoute] Restore history created (from-dropbox)');

    // Debug: 作成直後に存在確認（P2025の切り分け用）
    try {
      await historyService.getHistoryById(preHistoryId);
      logger?.info({ historyId: preHistoryId }, '[BackupRoute] Restore history exists (from-dropbox)');
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      logger?.error({ historyId: preHistoryId, err: msg }, '[BackupRoute] Restore history NOT FOUND right after create (from-dropbox)');
    }

    // databaseリストアはDBを再構築するため、途中で履歴レコードが消える（P2025）ことがある
    let databaseRestoreStarted = false;

    try {
      // Dropboxからバックアップファイルをダウンロード
      // データベースバックアップの場合、拡張子がない場合は.sql.gzを試す
      let backupData: Buffer;
      try {
        logger?.info({ backupPath: actualBackupPath, originalPath: body.backupPath }, '[BackupRoute] Downloading backup from Dropbox');
        backupData = await dropboxProvider.download(actualBackupPath);
      } catch (error) {
        // データベースバックアップで拡張子付きで失敗した場合、拡張子なしで再試行（既存バックアップとの互換性）
        if (targetKind === 'database' && actualBackupPath.endsWith('.sql.gz') && normalizedBackupPath !== actualBackupPath) {
          logger?.info({ backupPath: normalizedBackupPath, originalPath: body.backupPath }, '[BackupRoute] Retrying download without extension for compatibility');
          try {
            backupData = await dropboxProvider.download(normalizedBackupPath);
            actualBackupPath = normalizedBackupPath; // 実際に使用したパスを更新
          } catch (_retryError) {
            throw error; // 元のエラーをスロー
          }
        } else {
          throw error;
        }
      }

      // 整合性検証
      if (body.verifyIntegrity) {
        const { BackupVerifier } = await import('../../services/backup/backup-verifier.js');
        const verification = BackupVerifier.verify(
          backupData,
          body.expectedSize,
          body.expectedHash
        );

        if (!verification.valid) {
          logger?.error(
            { errors: verification.errors, backupPath: actualBackupPath, originalPath: body.backupPath },
            '[BackupRoute] Backup integrity verification failed'
          );
          throw new ApiError(400, `Backup integrity verification failed: ${verification.errors.join(', ')}`);
        }

        logger?.info(
          { fileSize: verification.fileSize, hash: verification.hash, backupPath: actualBackupPath },
          '[BackupRoute] Backup integrity verified'
        );
      }

      // バックアップターゲットを作成（Factoryパターンを使用）
      const target = BackupTargetFactory.createFromConfig(config, targetKind as BackupKind, targetSource);

      // ターゲットがrestoreメソッドを実装している場合はそれを使用
      if (target.restore) {
        logger?.info({ targetKind, targetSource, backupPath: actualBackupPath, originalPath: body.backupPath }, '[BackupRoute] Restoring using target restore method');
        if (targetKind === 'database') {
          databaseRestoreStarted = true;
          logger?.info({ preHistoryId }, '[BackupRoute] Database restore started; preHistory may be overwritten');
        }
        const result = await target.restore(backupData, {
          overwrite: true,
        });

        // リストア履歴を完了として更新
        // databaseリストアの場合、リストア処理でDBが上書きされるため、preHistoryIdが消えてupdateでP2025になり得る
        // -> リストア完了後に新しい履歴を作成して完了として記録する
        if (targetKind === 'database') {
          const postHistoryId = await historyService.createHistory({
            operationType: BackupOperationType.RESTORE,
            targetKind,
            targetSource,
            backupPath: normalizedBackupPath,
            storageProvider: 'dropbox',
          });
          await historyService.completeHistory(postHistoryId, {
            targetKind,
            targetSource,
            sizeBytes: backupData.length,
            hash: body.verifyIntegrity ? (await import('../../services/backup/backup-verifier.js')).BackupVerifier.calculateHash(backupData) : undefined,
            path: actualBackupPath,
          });

          return reply.status(200).send({
            success: result.success,
            timestamp: result.timestamp,
            historyId: postHistoryId,
          });
        } else {
          await historyService.completeHistory(preHistoryId, {
            targetKind,
            targetSource,
            sizeBytes: backupData.length,
            hash: body.verifyIntegrity ? (await import('../../services/backup/backup-verifier.js')).BackupVerifier.calculateHash(backupData) : undefined,
            path: actualBackupPath,
          });
        }

        return reply.status(200).send({
          success: result.success,
          timestamp: result.timestamp,
          historyId: preHistoryId,
        });
      } else {
        // restoreメソッドが実装されていない場合は汎用的なリストア（ファイルとして保存）
        const tempPath = `/tmp/restored-${Date.now()}.backup`;
        await backupService.restore(normalizedBackupPath, {
          destination: tempPath,
        });

        logger?.info({ backupPath: actualBackupPath, originalPath: body.backupPath, tempPath }, '[BackupRoute] Backup restored to temporary file');

        // リストア履歴を完了として更新
        await historyService.completeHistory(preHistoryId, {
          targetKind,
          targetSource,
          sizeBytes: backupData.length,
          hash: body.verifyIntegrity ? (await import('../../services/backup/backup-verifier.js')).BackupVerifier.calculateHash(backupData) : undefined,
          path: actualBackupPath,
        });
      }

      return reply.status(200).send({
        success: true,
        message: 'Backup restored successfully',
        backupPath: actualBackupPath,
        originalPath: body.backupPath,
        timestamp: new Date(),
        historyId: preHistoryId,
      });
    } catch (error) {
      logger?.error(
        { err: error, backupPath: actualBackupPath, originalPath: body.backupPath, normalizedBackupPath },
        '[BackupRoute] Failed to restore backup from Dropbox'
      );

      // リストア履歴を失敗として更新
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      // databaseリストアが開始された後はDBが上書きされてpreHistoryIdが消える可能性が高い
      if (targetKind === 'database' && databaseRestoreStarted) {
        try {
          const postFailHistoryId = await historyService.createHistory({
            operationType: BackupOperationType.RESTORE,
            targetKind,
            targetSource,
            backupPath: normalizedBackupPath,
            storageProvider: 'dropbox',
          });
          await historyService.failHistory(postFailHistoryId, errorMessage);
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          logger?.error({ err: msg }, '[BackupRoute] Failed to record post-restore failure history (database)');
        }
      } else {
        await historyService.failHistory(preHistoryId, errorMessage);
      }

      if (error instanceof ApiError) {
        throw error;
      }

      // ファイルが見つからない場合のエラーメッセージを改善
      if (errorMessage.includes('not found') || errorMessage.includes('Backup file not found')) {
        throw new ApiError(
          404,
          `Backup file not found: ${body.backupPath}. Please check the backup path and ensure the file exists in Dropbox.`
        );
      }

      throw new ApiError(
        500,
        `Failed to restore backup: ${errorMessage}`
      );
    }
  });
}
