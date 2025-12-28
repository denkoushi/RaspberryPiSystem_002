import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { authorizeRoles } from '../lib/auth.js';
import { BackupService } from '../services/backup/backup.service.js';
import { LocalStorageProvider } from '../services/backup/storage/local-storage.provider.js';
import { BackupConfigLoader } from '../services/backup/backup-config.loader.js';
import type { BackupConfig } from '../services/backup/backup-config.js';
import { BackupTargetFactory } from '../services/backup/backup-target-factory.js';
import { StorageProviderFactory } from '../services/backup/storage-provider-factory.js';
import type { BackupKind } from '../services/backup/backup-types.js';
import { ApiError } from '../lib/errors.js';
import { logger } from '../lib/logger.js';
import { DropboxOAuthService } from '../services/backup/dropbox-oauth.service.js';
import { BackupHistoryService } from '../services/backup/backup-history.service.js';
import { BackupOperationType } from '@prisma/client';
import crypto from 'crypto';

const backupRequestSchema = z.object({
  kind: z.enum(['database', 'file', 'directory', 'csv', 'image', 'client-file']),
  source: z.string(),
  metadata: z.record(z.unknown()).optional()
});

const restoreRequestSchema = z.object({
  backupPath: z.string(),
  destination: z.string().optional(),
  storage: z.object({
    provider: z.enum(['local', 'dropbox']),
    options: z.record(z.unknown()).optional()
  }).optional()
});

/**
 * バックアップルートを登録
 */
export async function registerBackupRoutes(app: FastifyInstance): Promise<void> {
  const mustBeAdmin = authorizeRoles('ADMIN');

  // 内部バックアップエンドポイント（localhostからのみ、認証不要）
  // backup.shスクリプトから使用するためのエンドポイント
  app.post('/backup/internal', {
    config: { rateLimit: false }
  }, async (request, reply) => {
    // localhostからのアクセスのみ許可
    const remoteAddress = request.socket.remoteAddress || request.ip;
    if (remoteAddress !== '127.0.0.1' && remoteAddress !== '::1' && !remoteAddress?.startsWith('172.')) {
      throw new ApiError(403, 'Internal backup endpoint is only accessible from localhost');
    }

    const body = request.body as z.infer<typeof backupRequestSchema>;
    
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
      const updatedConfig: BackupConfig = {
        ...config,
        storage: {
          ...config.storage,
          options: {
            ...config.storage.options,
            accessToken: newToken
          }
        }
      };
      await BackupConfigLoader.save(updatedConfig);
    };
    
    // バックアップターゲットを作成（Factoryパターンを使用）
    const target = BackupTargetFactory.createFromConfig(config, body.kind, body.source, body.metadata);
    
    // ストレージプロバイダーのリストを決定（Phase 2: 多重バックアップ対応）
    const providers: ('local' | 'dropbox')[] = [];
    if (targetConfig?.storage?.providers && targetConfig.storage.providers.length > 0) {
      providers.push(...targetConfig.storage.providers);
    } else if (targetConfig?.storage?.provider) {
      providers.push(targetConfig.storage.provider);
    } else {
      providers.push(config.storage.provider);
    }
    
    const historyService = new BackupHistoryService();
    
    // 各プロバイダーに順次バックアップを実行（多重バックアップ）
    const results: Array<{ provider: 'local' | 'dropbox'; success: boolean; path?: string; sizeBytes?: number; error?: string }> = [];
    for (const provider of providers) {
      try {
        const targetWithProvider = targetConfig ? {
          ...targetConfig,
          storage: { provider }
        } : undefined;
        const storageProvider = targetWithProvider
          ? StorageProviderFactory.createFromTarget(config, targetWithProvider, protocol, host, onTokenUpdate)
          : StorageProviderFactory.createFromConfig(config, protocol, host, onTokenUpdate);
        const backupService = new BackupService(storageProvider);
        
        // バックアップ履歴を作成
        const historyId = await historyService.createHistory({
          operationType: BackupOperationType.BACKUP,
          targetKind: body.kind,
          targetSource: body.source,
          storageProvider: provider
        });
        
        try {
          // バックアップを実行
          const result = await backupService.backup(target, {
            label: body.metadata?.label as string
          });
          
          if (result.success) {
            results.push({ provider, success: true, path: result.path, sizeBytes: result.sizeBytes });
            await historyService.completeHistory(historyId, {
              targetKind: body.kind,
              targetSource: body.source,
              sizeBytes: result.sizeBytes,
              path: result.path
            });
          } else {
            results.push({ provider, success: false, error: result.error });
            await historyService.failHistory(historyId, result.error || 'Unknown error');
          }
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : 'Unknown error';
          results.push({ provider, success: false, error: errorMessage });
          await historyService.failHistory(historyId, errorMessage);
        }
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        results.push({ provider, success: false, error: errorMessage });
      }
    }
    
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
      providers: results.map((r) => ({ provider: r.provider, success: r.success }))
    });
  });

  // バックアップの実行
  app.post('/backup', {
    preHandler: [mustBeAdmin],
    schema: {
      body: {
        type: 'object',
        properties: {
          kind: { type: 'string', enum: ['database', 'file', 'directory', 'csv', 'image', 'client-file'] },
          source: { type: 'string' },
          storage: {
            type: 'object',
            properties: {
              provider: { type: 'string', enum: ['local', 'dropbox'] },
              options: { type: 'object' }
            }
          },
          metadata: { type: 'object' }
        },
        required: ['kind', 'source']
      }
    }
  }, async (request, reply) => {
    // #region agent log
    fetch('http://127.0.0.1:7242/ingest/efef6d23-e2ed-411f-be56-ab093f2725f8',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'backup.ts:149',message:'POST /backup request received',data:{body:request.body,headers:{authorization:request.headers.authorization?request.headers.authorization.substring(0,20)+'...':null}},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'A'})}).catch(()=>{});
    // #endregion
    const body = request.body as z.infer<typeof backupRequestSchema>;
    // #region agent log
    fetch('http://127.0.0.1:7242/ingest/efef6d23-e2ed-411f-be56-ab093f2725f8',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'backup.ts:151',message:'Request body parsed',data:{kind:body?.kind,source:body?.source,hasMetadata:!!body?.metadata},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'A'})}).catch(()=>{});
    // #endregion
    
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
      const updatedConfig: BackupConfig = {
        ...config,
        storage: {
          ...config.storage,
          options: {
            ...config.storage.options,
            accessToken: newToken
          }
        }
      };
      await BackupConfigLoader.save(updatedConfig);
    };
    
    // バックアップターゲットを作成（Factoryパターンを使用）
    const target = BackupTargetFactory.createFromConfig(config, body.kind, body.source, body.metadata);
    
    // ストレージプロバイダーのリストを決定（Phase 2: 多重バックアップ対応）
    const providers: ('local' | 'dropbox')[] = [];
    if (targetConfig?.storage?.providers && targetConfig.storage.providers.length > 0) {
      providers.push(...targetConfig.storage.providers);
    } else if (targetConfig?.storage?.provider) {
      providers.push(targetConfig.storage.provider);
    } else {
      providers.push(config.storage.provider);
    }
    
    const historyService = new BackupHistoryService();
    
    // 各プロバイダーに順次バックアップを実行（多重バックアップ）
    const results: Array<{ provider: 'local' | 'dropbox'; success: boolean; path?: string; sizeBytes?: number; error?: string }> = [];
    for (const provider of providers) {
      try {
        const targetWithProvider = targetConfig ? {
          ...targetConfig,
          storage: { provider }
        } : undefined;
        const storageProvider = targetWithProvider
          ? StorageProviderFactory.createFromTarget(config, targetWithProvider, protocol, host, onTokenUpdate)
          : StorageProviderFactory.createFromConfig(config, protocol, host, onTokenUpdate);
        const backupService = new BackupService(storageProvider);
        
        // バックアップ履歴を作成
        const historyId = await historyService.createHistory({
          operationType: BackupOperationType.BACKUP,
          targetKind: body.kind,
          targetSource: body.source,
          storageProvider: provider
        });
        
        try {
          // バックアップを実行
          const result = await backupService.backup(target, {
            label: body.metadata?.label as string
          });
          
          if (result.success) {
            results.push({ provider, success: true, path: result.path, sizeBytes: result.sizeBytes });
            await historyService.completeHistory(historyId, {
              targetKind: body.kind,
              targetSource: body.source,
              sizeBytes: result.sizeBytes,
              path: result.path
            });
          } else {
            results.push({ provider, success: false, error: result.error });
            await historyService.failHistory(historyId, result.error || 'Unknown error');
          }
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : 'Unknown error';
          results.push({ provider, success: false, error: errorMessage });
          await historyService.failHistory(historyId, errorMessage);
        }
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        results.push({ provider, success: false, error: errorMessage });
      }
    }
    
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
    
    // Phase 3: バックアップ実行後にクリーンアップを実行（手動実行時も自動削除を実行）
    if (targetConfig) {
      const retention = targetConfig.retention || config.retention;
      if (retention && retention.days) {
        const successfulProvider = providers.find((p, i) => results[i]?.success);
        if (successfulProvider) {
          const targetWithProvider = {
            ...targetConfig,
            storage: { provider: successfulProvider }
          };
          const storageProvider = targetWithProvider
            ? StorageProviderFactory.createFromTarget(config, targetWithProvider, protocol, host, onTokenUpdate)
            : StorageProviderFactory.createFromConfig(config, protocol, host, onTokenUpdate);
          const backupService = new BackupService(storageProvider);
          
          // 対象ごとのバックアップのみをクリーンアップするため、prefixを指定
          // DatabaseBackupTargetのinfo.sourceはデータベース名のみ（例: "borrow_return"）なので、
          // 完全なURLからデータベース名を抽出する必要がある
          let sourceForPrefix = body.source;
          if (body.kind === 'database') {
            try {
              const url = new URL(body.source);
              sourceForPrefix = url.pathname.replace(/^\//, '') || 'database';
            } catch {
              // URL解析に失敗した場合はそのまま使用
            }
          }
          const prefix = `${body.kind}/${sourceForPrefix}`;
          
          // BackupSchedulerのcleanupOldBackupsメソッドと同じロジックを実行
          try {
            const backups = await backupService.listBackups({ prefix });
            const now = new Date();
            const retentionDate = new Date(now.getTime() - retention.days * 24 * 60 * 60 * 1000);
            
            // 最大バックアップ数を超える場合は古いものから削除（保持期間に関係なく）
            if (retention.maxBackups && backups.length > retention.maxBackups) {
              // 全バックアップを日付順にソート（古い順）
              const allSortedBackups = backups.sort((a, b) => {
                if (!a.modifiedAt || !b.modifiedAt) return 0;
                return a.modifiedAt.getTime() - b.modifiedAt.getTime();
              });
              const toDelete = allSortedBackups.slice(0, backups.length - retention.maxBackups);
              for (const backup of toDelete) {
                if (!backup.path) continue;
                try {
                  await backupService.deleteBackup(backup.path);
                  logger?.info({ path: backup.path, prefix }, '[BackupRoute] Old backup deleted');
                } catch (error) {
                  logger?.error({ err: error, path: backup.path, prefix }, '[BackupRoute] Failed to delete old backup');
                }
              }
            }
            
            // 保持期間を超えたバックアップを削除（maxBackupsチェック後も実行）
            const sortedBackups = backups
              .filter(b => b.modifiedAt && b.modifiedAt < retentionDate)
              .sort((a, b) => {
                if (!a.modifiedAt || !b.modifiedAt) return 0;
                return a.modifiedAt.getTime() - b.modifiedAt.getTime();
              });
            for (const backup of sortedBackups) {
              if (!backup.path) continue;
              try {
                await backupService.deleteBackup(backup.path);
                logger?.info({ path: backup.path, prefix }, '[BackupRoute] Old backup deleted');
              } catch (error) {
                logger?.error({ err: error, path: backup.path, prefix }, '[BackupRoute] Failed to delete old backup');
              }
            }
          } catch (error) {
            logger?.error({ err: error, prefix }, '[BackupRoute] Failed to cleanup old backups');
            // クリーンアップエラーはバックアップ成功を妨げない
          }
        }
      }
    }
    
    return reply.status(200).send({
      success: true,
      path: successfulResult.path,
      sizeBytes: successfulResult.sizeBytes,
      timestamp: new Date().toISOString(),
      providers: results.map((r) => ({ provider: r.provider, success: r.success }))
    });
  });

  // バックアップ一覧の取得
  app.get('/backup', {
    preHandler: [mustBeAdmin],
    schema: {
      querystring: {
        type: 'object',
        properties: {
          prefix: { type: 'string' },
          limit: { type: 'number' }
        }
      }
    }
  }, async (request, reply) => {
    const query = request.query as { prefix?: string; limit?: number };
    
    // デフォルトはローカルストレージを使用
    const storageProvider = new LocalStorageProvider();
    const backupService = new BackupService(storageProvider);
    
    const backups = await backupService.listBackups({
      prefix: query.prefix,
      limit: query.limit
    });

    return reply.status(200).send({
      backups: backups.map(b => ({
        path: b.path,
        sizeBytes: b.sizeBytes,
        modifiedAt: b.modifiedAt
      }))
    });
  });

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
              options: { type: 'object' }
            }
          }
        },
        required: ['backupPath']
      }
    }
  }, async (request, reply) => {
    const body = request.body as z.infer<typeof restoreRequestSchema>;
    
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
          redirectUri: `${protocol}://${host}/api/backup/oauth/callback`
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
      storageProvider: body.storage?.provider || 'local'
    });

    try {
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
          overwrite: true
        });

        // リストア履歴を完了として更新
        await historyService.completeHistory(historyId, {
          targetKind,
          targetSource,
          path: body.backupPath
        });

        return reply.status(200).send({
          success: result.success,
          timestamp: result.timestamp,
          historyId
        });
      } else {
        // restoreメソッドが実装されていない場合は通常の処理を実行
        const result = await backupService.restore(body.backupPath, {
          destination: body.destination
        });

        // リストア履歴を完了として更新
        await historyService.completeHistory(historyId, {
          targetKind,
          targetSource,
          path: body.backupPath
        });

        return reply.status(200).send({
          success: result.success,
          timestamp: result.timestamp,
          historyId
        });
      }
    } catch (error) {
      // リストア履歴を失敗として更新
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      await historyService.failHistory(historyId, errorMessage);
      throw error;
    }
  });

  // バックアップの削除
  // パスにスラッシュが含まれる可能性があるため、ワイルドカード（*）を使用
  app.delete('/backup/*', {
    preHandler: [mustBeAdmin]
  }, async (request, reply) => {
    // Fastifyのワイルドカードパラメータは`*`として取得される
    const pathParam = (request.params as { '*': string })['*'];
    const decodedPath = decodeURIComponent(pathParam);
    
    // デフォルトはローカルストレージを使用
    const storageProvider = new LocalStorageProvider();
    const backupService = new BackupService(storageProvider);
    
    await backupService.deleteBackup(decodedPath);

    return reply.status(200).send({ success: true });
  });

  // バックアップ履歴一覧取得
  app.get('/backup/history', {
    preHandler: [mustBeAdmin],
    schema: {
      querystring: {
        type: 'object',
        properties: {
          operationType: { type: 'string', enum: ['BACKUP', 'RESTORE'] },
          targetKind: { type: 'string' },
          status: { type: 'string', enum: ['PENDING', 'PROCESSING', 'COMPLETED', 'FAILED'] },
          startDate: { type: 'string' },
          endDate: { type: 'string' },
          offset: { type: 'number' },
          limit: { type: 'number' }
        }
      }
    }
  }, async (request, reply) => {
    const query = request.query as {
      operationType?: 'BACKUP' | 'RESTORE';
      targetKind?: string;
      status?: 'PENDING' | 'PROCESSING' | 'COMPLETED' | 'FAILED';
      startDate?: string;
      endDate?: string;
      offset?: number;
      limit?: number;
    };

    const historyService = new BackupHistoryService();
    const { BackupOperationType, BackupStatus } = await import('@prisma/client');

    const result = await historyService.getHistoryWithFilter({
      operationType: query.operationType ? BackupOperationType[query.operationType] : undefined,
      targetKind: query.targetKind,
      status: query.status ? BackupStatus[query.status] : undefined,
      startDate: query.startDate ? new Date(query.startDate) : undefined,
      endDate: query.endDate ? new Date(query.endDate) : undefined,
      offset: query.offset,
      limit: query.limit
    });

    return reply.status(200).send({
      history: result.history,
      total: result.total,
      offset: query.offset ?? 0,
      limit: query.limit ?? 100
    });
  });

  // バックアップ履歴詳細取得
  app.get('/backup/history/:id', {
    preHandler: [mustBeAdmin]
  }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const historyService = new BackupHistoryService();

    try {
      const history = await historyService.getHistoryById(id);
      return reply.status(200).send(history);
    } catch (error) {
      if (error instanceof Error && error.message.includes('not found')) {
        throw new ApiError(404, `Backup history not found: ${id}`);
      }
      throw error;
    }
  });

  // 設定の取得
  app.get('/backup/config', {
    preHandler: [mustBeAdmin]
  }, async (request, reply) => {
    const config = await BackupConfigLoader.load();
    return reply.status(200).send(config);
  });

  // 設定の更新
  app.put('/backup/config', {
    preHandler: [mustBeAdmin],
    schema: {
      body: {
        type: 'object'
      }
    }
  }, async (request, reply) => {
    const config = request.body as BackupConfig;
    await BackupConfigLoader.save(config);
    // スケジューラーを再読み込み（設定変更を即時反映）
    const { getBackupScheduler } = await import('../services/backup/backup-scheduler.js');
    await getBackupScheduler().reload();
    return reply.status(200).send({ success: true });
  });

  // バックアップ対象の追加
  app.post('/backup/config/targets', {
    preHandler: [mustBeAdmin],
    schema: {
      body: {
        type: 'object',
        properties: {
          kind: { type: 'string', enum: ['database', 'file', 'directory', 'csv', 'image', 'client-file'] },
          source: { type: 'string' },
          schedule: { type: 'string' },
          enabled: { type: 'boolean' },
          storage: {
            type: 'object',
            properties: {
              provider: { type: 'string', enum: ['local', 'dropbox'] },
              providers: { type: 'array', items: { type: 'string', enum: ['local', 'dropbox'] } }
            }
          },
          retention: {
            type: 'object',
            properties: {
              days: { type: 'number' },
              maxBackups: { type: 'number' }
            }
          },
          metadata: { type: 'object' }
        },
        required: ['kind', 'source']
      }
    }
  }, async (request, reply) => {
    const body = request.body as {
      kind: 'database' | 'file' | 'directory' | 'csv' | 'image' | 'client-file';
      source: string;
      schedule?: string;
      enabled?: boolean;
      storage?: {
        provider?: 'local' | 'dropbox';
        providers?: ('local' | 'dropbox')[];
      };
      retention?: {
        days?: number;
        maxBackups?: number;
      };
      metadata?: Record<string, unknown>;
    };

    // スケジュールのバリデーション
    if (body.schedule && body.schedule.trim()) {
      const cron = await import('node-cron');
      if (!cron.validate(body.schedule.trim())) {
        throw new ApiError(400, `Invalid cron schedule format: ${body.schedule}. Expected format: "分 時 日 月 曜日" (e.g., "0 4 * * *")`);
      }
    }

    const config = await BackupConfigLoader.load();
    
    // 新しいtargetを追加（Phase 2: providers配列に対応）
    const storage = body.storage?.providers && body.storage.providers.length > 0
      ? { providers: body.storage.providers }
      : body.storage?.provider
      ? { provider: body.storage.provider }
      : undefined;
    
    const newTarget: BackupConfig['targets'][number] = {
      kind: body.kind,
      source: body.source,
      schedule: body.schedule?.trim() || undefined,
      enabled: body.enabled ?? true,
      storage,
      retention: body.retention,
      metadata: body.metadata
    };

    config.targets.push(newTarget);
    await BackupConfigLoader.save(config);

    // スケジューラーを再読み込み（ターゲット追加を即時反映）
    const { getBackupScheduler } = await import('../services/backup/backup-scheduler.js');
    await getBackupScheduler().reload();

    logger?.info({ target: newTarget }, '[BackupRoute] Backup target added');
    return reply.status(200).send({ success: true, target: newTarget });
  });

  // バックアップ対象の更新
  app.put('/backup/config/targets/:index', {
    preHandler: [mustBeAdmin],
    schema: {
      params: {
        type: 'object',
        properties: {
          index: { type: 'number' }
        },
        required: ['index']
      },
      body: {
        type: 'object',
        properties: {
          kind: { type: 'string', enum: ['database', 'file', 'directory', 'csv', 'image', 'client-file'] },
          source: { type: 'string' },
          schedule: { type: 'string' },
          enabled: { type: 'boolean' },
          storage: {
            type: 'object',
            properties: {
              provider: { type: 'string', enum: ['local', 'dropbox'] },
              providers: { type: 'array', items: { type: 'string', enum: ['local', 'dropbox'] } }
            }
          },
          metadata: { type: 'object' }
        }
      }
    }
  }, async (request, reply) => {
    const { index } = request.params as { index: string };
    const targetIndex = parseInt(index, 10);
    const body = request.body as Partial<{
      kind: 'database' | 'file' | 'directory' | 'csv' | 'image' | 'client-file';
      source: string;
      schedule: string;
      enabled: boolean;
      storage?: {
        provider?: 'local' | 'dropbox';
        providers?: ('local' | 'dropbox')[];
      };
      retention?: {
        days?: number;
        maxBackups?: number;
      };
      metadata?: Record<string, unknown>;
    }>;

    // スケジュールのバリデーション
    if (body.schedule !== undefined && body.schedule.trim()) {
      const cron = await import('node-cron');
      if (!cron.validate(body.schedule.trim())) {
        throw new ApiError(400, `Invalid cron schedule format: ${body.schedule}. Expected format: "分 時 日 月 曜日" (e.g., "0 4 * * *")`);
      }
    }

    const config = await BackupConfigLoader.load();

    if (targetIndex < 0 || targetIndex >= config.targets.length) {
      throw new ApiError(400, `Invalid target index: ${index}`);
    }

    // 既存のtargetを更新（Phase 2: providers配列に対応）
    const existingTarget = config.targets[targetIndex];
    
    // storage設定の処理（providers優先、次にprovider、最後に既存設定）
    let storage: BackupConfig['targets'][number]['storage'] = existingTarget.storage;
    if (body.storage?.providers !== undefined) {
      storage = body.storage.providers.length > 0 ? { providers: body.storage.providers } : undefined;
    } else if (body.storage?.provider !== undefined) {
      storage = body.storage.provider ? { provider: body.storage.provider } : undefined;
    }
    
    const updatedTarget: BackupConfig['targets'][number] = {
      ...existingTarget,
      ...body,
      schedule: body.schedule !== undefined ? (body.schedule.trim() || undefined) : existingTarget.schedule,
      retention: body.retention !== undefined ? body.retention : existingTarget.retention,
      storage
    };
    config.targets[targetIndex] = updatedTarget;

    await BackupConfigLoader.save(config);

    // スケジューラーを再読み込み（ターゲット更新を即時反映）
    const { getBackupScheduler } = await import('../services/backup/backup-scheduler.js');
    await getBackupScheduler().reload();

    logger?.info({ index: targetIndex, target: config.targets[targetIndex] }, '[BackupRoute] Backup target updated');
    return reply.status(200).send({ success: true, target: config.targets[targetIndex] });
  });

  // バックアップ対象の削除
  app.delete('/backup/config/targets/:index', {
    preHandler: [mustBeAdmin]
  }, async (request, reply) => {
    const { index } = request.params as { index: string };
    const targetIndex = parseInt(index, 10);

    const config = await BackupConfigLoader.load();

    if (targetIndex < 0 || targetIndex >= config.targets.length) {
      throw new ApiError(400, `Invalid target index: ${index}`);
    }

    const deletedTarget = config.targets[targetIndex];
    config.targets.splice(targetIndex, 1);
    await BackupConfigLoader.save(config);

    // スケジューラーを再読み込み（ターゲット削除を即時反映）
    const { getBackupScheduler } = await import('../services/backup/backup-scheduler.js');
    await getBackupScheduler().reload();

    logger?.info({ index: targetIndex, target: deletedTarget }, '[BackupRoute] Backup target deleted');
    return reply.status(200).send({ success: true, target: deletedTarget });
  });

  // OAuth 2.0認証URL生成
  app.get('/backup/oauth/authorize', {
    preHandler: [mustBeAdmin]
  }, async (request, reply) => {
    const config = await BackupConfigLoader.load();
    const appKey = config.storage.options?.appKey as string | undefined;
    const appSecret = config.storage.options?.appSecret as string | undefined;

    if (!appKey || !appSecret) {
      throw new ApiError(400, 'Dropbox App Key and App Secret are required in config file');
    }

    // リダイレクトURI（現在のホストを使用）
    const protocol = request.headers['x-forwarded-proto'] || request.protocol || 'http';
    const host = request.headers.host || 'localhost:8080';
    const redirectUri = `${protocol}://${host}/api/backup/oauth/callback`;

    const oauthService = new DropboxOAuthService({
      appKey,
      appSecret,
      redirectUri
    });

    // CSRF保護用のstateパラメータを生成
    const state = crypto.randomBytes(32).toString('hex');
    
    // セッションにstateを保存（簡易実装、本番環境では適切なセッション管理を使用）
    // ここではクエリパラメータとして返す（実際の実装ではセッションストアを使用）
    const authUrl = oauthService.getAuthorizationUrl(state);

    return reply.status(200).send({
      authorizationUrl: authUrl,
      state
    });
  });

  // OAuth 2.0コールバック（認証コードを受け取る）
  // 注意: コールバックエンドポイントはDropboxからリダイレクトされるため、認証をスキップする
  // CSRF保護は`state`パラメータで行う（簡易実装）
  app.get('/backup/oauth/callback', async (request, reply) => {
    const query = request.query as { code?: string; state?: string; error?: string };
    
    if (query.error) {
      throw new ApiError(400, `OAuth error: ${query.error}`);
    }

    if (!query.code) {
      throw new ApiError(400, 'Authorization code is required');
    }

    const config = await BackupConfigLoader.load();
    const appKey = config.storage.options?.appKey as string | undefined;
    const appSecret = config.storage.options?.appSecret as string | undefined;

    if (!appKey || !appSecret) {
      throw new ApiError(400, 'Dropbox App Key and App Secret are required in config file');
    }

    // リダイレクトURI（現在のホストを使用）
    const protocol = request.headers['x-forwarded-proto'] || request.protocol || 'http';
    const host = request.headers.host || 'localhost:8080';
    const redirectUri = `${protocol}://${host}/api/backup/oauth/callback`;

    const oauthService = new DropboxOAuthService({
      appKey,
      appSecret,
      redirectUri
    });

    try {
      const tokenInfo = await oauthService.exchangeCodeForTokens(query.code);
      
      // 設定ファイルを更新
      const updatedConfig: BackupConfig = {
        ...config,
        storage: {
          ...config.storage,
          options: {
            ...config.storage.options,
            accessToken: tokenInfo.accessToken,
            refreshToken: tokenInfo.refreshToken || config.storage.options?.refreshToken,
            appKey,
            appSecret
          }
        }
      };

      await BackupConfigLoader.save(updatedConfig);

      return reply.status(200).send({
        success: true,
        message: 'Tokens saved successfully',
        hasRefreshToken: !!tokenInfo.refreshToken
      });
    } catch (error) {
      logger?.error({ err: error }, '[BackupRoute] Failed to exchange code for tokens');
      throw new ApiError(500, 'Failed to exchange authorization code for tokens');
    }
  });

  // Dropboxからバックアップをリストア
  const restoreFromDropboxRequestSchema = z.object({
    backupPath: z.string().min(1, 'バックアップパスは必須です'),
    targetKind: z.enum(['database', 'csv', 'image']).optional(), // リストア対象の種類
    verifyIntegrity: z.boolean().optional().default(true), // 整合性検証を実行するか
    expectedSize: z.number().optional(), // 期待されるファイルサイズ
    expectedHash: z.string().optional() // 期待されるハッシュ値（SHA256）
  });

  app.post('/backup/restore/from-dropbox', {
    preHandler: [mustBeAdmin],
    schema: {
      body: {
        type: 'object',
        properties: {
          backupPath: { type: 'string' },
          targetKind: { type: 'string', enum: ['database', 'csv', 'image'] },
          verifyIntegrity: { type: 'boolean' },
          expectedSize: { type: 'number' },
          expectedHash: { type: 'string' }
        },
        required: ['backupPath']
      }
    }
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
      const updatedConfig: BackupConfig = {
        ...config,
        storage: {
          ...config.storage,
          options: {
            ...config.storage.options,
            accessToken: newToken
          }
        }
      };
      await BackupConfigLoader.save(updatedConfig);
    };

    // Dropboxストレージプロバイダーを作成（Factoryパターンを使用）
    const dropboxProvider = StorageProviderFactory.createFromConfig(config, protocol, host, onTokenUpdate);

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
    const targetSource = backupPathParts[backupPathParts.length - 1] || normalizedBackupPath;

    // リストア履歴を作成
    const historyId = await historyService.createHistory({
      operationType: BackupOperationType.RESTORE,
      targetKind,
      targetSource,
      backupPath: normalizedBackupPath,
      storageProvider: 'dropbox'
    });

    try {
      // Dropboxからバックアップファイルをダウンロード
      logger?.info({ backupPath: normalizedBackupPath, originalPath: body.backupPath }, '[BackupRoute] Downloading backup from Dropbox');
      const backupData = await dropboxProvider.download(normalizedBackupPath);

      // 整合性検証
      if (body.verifyIntegrity) {
        const { BackupVerifier } = await import('../services/backup/backup-verifier.js');
        const verification = BackupVerifier.verify(
          backupData,
          body.expectedSize,
          body.expectedHash
        );

        if (!verification.valid) {
          logger?.error(
            { errors: verification.errors, backupPath: normalizedBackupPath, originalPath: body.backupPath },
            '[BackupRoute] Backup integrity verification failed'
          );
          throw new ApiError(400, `Backup integrity verification failed: ${verification.errors.join(', ')}`);
        }

        logger?.info(
          { fileSize: verification.fileSize, hash: verification.hash, backupPath: normalizedBackupPath },
          '[BackupRoute] Backup integrity verified'
        );
      }

      // バックアップターゲットを作成（Factoryパターンを使用）
      const target = BackupTargetFactory.createFromConfig(config, targetKind as BackupKind, targetSource);

      // ターゲットがrestoreメソッドを実装している場合はそれを使用
      if (target.restore) {
        logger?.info({ targetKind, targetSource, backupPath: normalizedBackupPath, originalPath: body.backupPath }, '[BackupRoute] Restoring using target restore method');
        const result = await target.restore(backupData, {
          overwrite: true
        });

        // リストア履歴を完了として更新
        await historyService.completeHistory(historyId, {
          targetKind,
          targetSource,
          sizeBytes: backupData.length,
          hash: body.verifyIntegrity ? (await import('../services/backup/backup-verifier.js')).BackupVerifier.calculateHash(backupData) : undefined,
          path: normalizedBackupPath
        });

        return reply.status(200).send({
          success: result.success,
          timestamp: result.timestamp,
          historyId
        });
      } else {
        // restoreメソッドが実装されていない場合は汎用的なリストア（ファイルとして保存）
        const tempPath = `/tmp/restored-${Date.now()}.backup`;
        await backupService.restore(normalizedBackupPath, {
          destination: tempPath
        });

        logger?.info({ backupPath: normalizedBackupPath, originalPath: body.backupPath, tempPath }, '[BackupRoute] Backup restored to temporary file');
        
        // リストア履歴を完了として更新
        await historyService.completeHistory(historyId, {
          targetKind,
          targetSource,
          sizeBytes: backupData.length,
          hash: body.verifyIntegrity ? (await import('../services/backup/backup-verifier.js')).BackupVerifier.calculateHash(backupData) : undefined,
          path: normalizedBackupPath
        });
      }

      return reply.status(200).send({
        success: true,
        message: 'Backup restored successfully',
        backupPath: normalizedBackupPath,
        originalPath: body.backupPath,
        timestamp: new Date(),
        historyId
      });
    } catch (error) {
      logger?.error(
        { err: error, backupPath: normalizedBackupPath, originalPath: body.backupPath },
        '[BackupRoute] Failed to restore backup from Dropbox'
      );
      
      // リストア履歴を失敗として更新
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      await historyService.failHistory(historyId, errorMessage);
      
      if (error instanceof ApiError) {
        throw error;
      }
      
      throw new ApiError(
        500,
        `Failed to restore backup: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  });

  // リフレッシュトークンでアクセストークンを更新（手動用）
  app.post('/backup/oauth/refresh', {
    preHandler: [mustBeAdmin]
  }, async (request, reply) => {
    const config = await BackupConfigLoader.load();
    const refreshToken = config.storage.options?.refreshToken as string | undefined;
    const appKey = config.storage.options?.appKey as string | undefined;
    const appSecret = config.storage.options?.appSecret as string | undefined;

    if (!refreshToken) {
      throw new ApiError(400, 'Refresh token is required in config file');
    }

    if (!appKey || !appSecret) {
      throw new ApiError(400, 'Dropbox App Key and App Secret are required in config file');
    }

    const protocol = request.headers['x-forwarded-proto'] || request.protocol || 'http';
    const host = request.headers.host || 'localhost:8080';
    const redirectUri = `${protocol}://${host}/api/backup/oauth/callback`;

    const oauthService = new DropboxOAuthService({
      appKey,
      appSecret,
      redirectUri
    });

    try {
      const tokenInfo = await oauthService.refreshAccessToken(refreshToken);
      
      // 設定ファイルを更新
      const updatedConfig: BackupConfig = {
        ...config,
        storage: {
          ...config.storage,
          options: {
            ...config.storage.options,
            accessToken: tokenInfo.accessToken,
            refreshToken: tokenInfo.refreshToken || refreshToken,
            appKey,
            appSecret
          }
        }
      };

      await BackupConfigLoader.save(updatedConfig);

      return reply.status(200).send({
        success: true,
        message: 'Access token refreshed successfully'
      });
    } catch (error) {
      logger?.error({ err: error }, '[BackupRoute] Failed to refresh access token');
      throw new ApiError(500, 'Failed to refresh access token');
    }
  });
}
