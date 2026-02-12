import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import { authorizeRoles } from '../../lib/auth.js';
import { ApiError } from '../../lib/errors.js';
import { BackupConfigLoader } from '../../services/backup/backup-config.loader.js';
import type { BackupConfig } from '../../services/backup/backup-config.js';
import { executeBackupAcrossProviders, resolveBackupProviders } from '../../services/backup/backup-execution.service.js';
import { BackupTargetFactory } from '../../services/backup/backup-target-factory.js';
import { cleanupBackupsAfterManualExecution } from '../../services/backup/post-backup-cleanup.service.js';

type LegacyStorageOptions = NonNullable<BackupConfig['storage']['options']> & {
  accessToken?: string;
  refreshToken?: string;
  appKey?: string;
  appSecret?: string;
};

const backupRequestSchema = z.object({
  kind: z.enum(['database', 'file', 'directory', 'csv', 'image', 'client-file', 'client-directory']),
  source: z.string(),
  metadata: z.record(z.unknown()).optional(),
});

export async function registerBackupExecutionRoutes(app: FastifyInstance): Promise<void> {
  const mustBeAdmin = authorizeRoles('ADMIN');

  // 内部バックアップエンドポイント（localhostからのみ、認証不要）
  // backup.shスクリプトから使用するためのエンドポイント
  app.post('/backup/internal', {
    config: { rateLimit: false },
  }, async (request, reply) => {
    // localhostからのアクセスのみ許可
    const remoteAddress = request.socket.remoteAddress || request.ip;
    if (remoteAddress !== '127.0.0.1' && remoteAddress !== '::1' && !remoteAddress?.startsWith('172.')) {
      throw new ApiError(403, 'Internal backup endpoint is only accessible from localhost');
    }

    const body = backupRequestSchema.parse(request.body ?? {});

    // 設定ファイルを読み込む
    const config = await BackupConfigLoader.load();

    // 設定ファイルから対象を検索（対象ごとのストレージ設定を取得するため）
    const targetConfig = config.targets.find(
      (t) => t.kind === body.kind && t.source === body.source
    );

    // ストレージプロバイダーを作成（Factoryパターンを使用）
    const protocol = Array.isArray(request.headers['x-forwarded-proto'])
      ? request.headers['x-forwarded-proto'][0]
      : (request.headers['x-forwarded-proto'] || request.protocol || 'http');
    const host = Array.isArray(request.headers.host)
      ? request.headers.host[0]
      : (request.headers.host || 'localhost:8080');

    // トークン更新コールバック（設定ファイルを更新）
    const onTokenUpdate = async (newToken: string) => {
      // NOTE: {...config} で新オブジェクトを作るとフォールバック検知マーカーが落ち得るため、最新を読み直して更新する
      const latest = await BackupConfigLoader.load();
      (latest.storage.options ??= {});
      const legacyOpts = latest.storage.options as LegacyStorageOptions;
      legacyOpts.accessToken = newToken;
      // 新構造も更新
      legacyOpts.dropbox = { ...(legacyOpts.dropbox ?? {}), accessToken: newToken };
      await BackupConfigLoader.save(latest);
    };

    // バックアップターゲットを作成（Factoryパターンを使用）
    const target = BackupTargetFactory.createFromConfig(config, body.kind, body.source, body.metadata);

    const { results } = await executeBackupAcrossProviders({
      config,
      targetConfig,
      target,
      targetKind: body.kind,
      targetSource: body.source,
      protocol,
      host,
      onTokenUpdate,
      label: body.metadata?.label as string,
      includeDurationInSummary: true,
      includeProviderInSummary: true,
    });

    // すべてのプロバイダーで失敗した場合はエラーをスロー
    const allFailed = results.every((r) => !r.success);
    if (allFailed) {
      const errorMessages = results.map((r) => `${r.provider}: ${r.error || 'Unknown error'}`).join('; ');
      throw new ApiError(500, `Backup failed on all providers: ${errorMessages}`);
    }

    // 成功した最初の結果を返す
    const successfulResult = results.find((r) => r.success);
    if (!successfulResult) {
      throw new ApiError(500, 'No successful backup result');
    }

    return reply.status(200).send({
      success: true,
      path: successfulResult.path,
      sizeBytes: successfulResult.sizeBytes,
      timestamp: new Date().toISOString(),
      historyId: results.find((r) => r.success) ? 'multiple' : undefined,
      providers: results.map((r) => ({ provider: r.provider, success: r.success })),
    });
  });

  // バックアップの実行
  app.post('/backup', {
    preHandler: [mustBeAdmin],
    schema: {
      body: {
        type: 'object',
        properties: {
          kind: { type: 'string', enum: ['database', 'file', 'directory', 'csv', 'image', 'client-file', 'client-directory'] },
          source: { type: 'string' },
          storage: {
            type: 'object',
            properties: {
              provider: { type: 'string', enum: ['local', 'dropbox'] },
              options: { type: 'object' },
            },
          },
          metadata: { type: 'object' },
        },
        required: ['kind', 'source'],
      },
    },
  }, async (request, reply) => {
    const body = backupRequestSchema.parse(request.body ?? {});

    // 設定ファイルを読み込む
    const config = await BackupConfigLoader.load();

    // 設定ファイルから対象を検索（対象ごとのストレージ設定を取得するため）
    const targetConfig = config.targets.find(
      (t) => t.kind === body.kind && t.source === body.source
    );

    // ストレージプロバイダーを作成（Factoryパターンを使用）
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
      const opts = latestConfig.storage.options as NonNullable<BackupConfig['storage']['options']>;
      opts.dropbox = { ...(opts.dropbox ?? {}), accessToken: newToken };
      await BackupConfigLoader.save(latestConfig);
    };

    // バックアップターゲットを作成（Factoryパターンを使用）
    const target = BackupTargetFactory.createFromConfig(config, body.kind, body.source, body.metadata);

    const resolvedProviders = resolveBackupProviders({ config, targetConfig });
    const { results } = await executeBackupAcrossProviders({
      config,
      targetConfig,
      target,
      targetKind: body.kind,
      targetSource: body.source,
      protocol,
      host,
      onTokenUpdate,
      label: body.metadata?.label as string,
    });

    // すべてのプロバイダーで失敗した場合はエラーをスロー
    const allFailed = results.every((r) => !r.success);
    if (allFailed) {
      const errorMessages = results.map((r) => `${r.provider}: ${r.error || 'Unknown error'}`).join('; ');
      throw new ApiError(500, `Backup failed on all providers: ${errorMessages}`);
    }

    // 成功した最初の結果を返す
    const successfulResult = results.find((r) => r.success);
    if (!successfulResult) {
      throw new ApiError(500, 'No successful backup result');
    }

    await cleanupBackupsAfterManualExecution({
      config,
      targetConfig,
      targetKind: body.kind,
      targetSource: body.source,
      protocol,
      host,
      resolvedProviders,
      results,
      onTokenUpdate,
    });

    return reply.status(200).send({
      success: true,
      path: successfulResult.path,
      sizeBytes: successfulResult.sizeBytes,
      timestamp: new Date().toISOString(),
      providers: results.map((r) => ({ provider: r.provider, success: r.success })),
    });
  });
}
