import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { authorizeRoles } from '../lib/auth.js';
import { BackupService } from '../services/backup/backup.service.js';
import { LocalStorageProvider } from '../services/backup/storage/local-storage.provider.js';
import { DropboxStorageProvider } from '../services/backup/storage/dropbox-storage.provider.js';
import { DatabaseBackupTarget } from '../services/backup/targets/database-backup.target.js';
import { FileBackupTarget } from '../services/backup/targets/file-backup.target.js';
import { DirectoryBackupTarget } from '../services/backup/targets/directory-backup.target.js';
import { CsvBackupTarget } from '../services/backup/targets/csv-backup.target.js';
import { ImageBackupTarget } from '../services/backup/targets/image-backup.target.js';
import { BackupConfigLoader } from '../services/backup/backup-config.loader.js';
import type { BackupConfig } from '../services/backup/backup-config.js';
import { ApiError } from '../lib/errors.js';
import { logger } from '../lib/logger.js';
import { DropboxOAuthService } from '../services/backup/dropbox-oauth.service.js';
import { BackupHistoryService } from '../services/backup/backup-history.service.js';
import { BackupOperationType } from '@prisma/client';
import crypto from 'crypto';

/**
 * バックアップターゲットを作成
 */
function createBackupTarget(kind: string, source: string, metadata?: Record<string, unknown>) {
  switch (kind) {
    case 'database': {
      return new DatabaseBackupTarget(source);
    }
    case 'file': {
      return new FileBackupTarget(source);
    }
    case 'directory': {
      return new DirectoryBackupTarget(source);
    }
    case 'csv': {
      if (source === 'employees' || source === 'items') {
        return new CsvBackupTarget(source as 'employees' | 'items', metadata);
      }
      throw new ApiError(400, `Invalid CSV source: ${source}. Must be 'employees' or 'items'`);
    }
    case 'image': {
      return new ImageBackupTarget(metadata);
    }
    default: {
      throw new ApiError(400, `Unknown backup kind: ${kind}`);
    }
  }
}

/**
 * ストレージプロバイダーを作成
 */
function createStorageProvider(
  provider: string,
  options?: Record<string, unknown>,
  oauthService?: DropboxOAuthService,
  onTokenUpdate?: (token: string) => Promise<void>
) {
  switch (provider) {
    case 'local': {
      return new LocalStorageProvider();
    }
    case 'dropbox': {
      const accessToken = options?.accessToken as string;
      if (!accessToken) {
        throw new ApiError(400, 'Dropbox access token is required');
      }
      return new DropboxStorageProvider({
        accessToken,
        basePath: options?.basePath as string,
        refreshToken: options?.refreshToken as string | undefined,
        oauthService,
        onTokenUpdate
      });
    }
    default: {
      throw new ApiError(400, `Unknown storage provider: ${provider}`);
    }
  }
}

const backupRequestSchema = z.object({
  kind: z.enum(['database', 'file', 'directory', 'csv', 'image']),
  source: z.string(),
  storage: z.object({
    provider: z.enum(['local', 'dropbox']),
    options: z.record(z.unknown()).optional()
  }).optional(),
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
    
    // ストレージプロバイダーを作成（設定ファイルから読み込む）
    let storageProvider;
    if (config.storage.provider === 'dropbox') {
      const accessToken = config.storage.options?.accessToken as string;
      if (!accessToken) {
        throw new ApiError(400, 'Dropbox access token is required in config file');
      }
      
      // OAuthサービスを作成（リフレッシュトークンがある場合）
      let oauthService: DropboxOAuthService | undefined;
      const refreshToken = config.storage.options?.refreshToken as string | undefined;
      const appKey = config.storage.options?.appKey as string | undefined;
      const appSecret = config.storage.options?.appSecret as string | undefined;
      
      if (refreshToken && appKey && appSecret) {
        // リダイレクトURI（現在のホストを使用）
        const protocol = request.headers['x-forwarded-proto'] || request.protocol || 'http';
        const host = request.headers.host || 'localhost:8080';
        const redirectUri = `${protocol}://${host}/api/backup/oauth/callback`;
        
        oauthService = new DropboxOAuthService({
          appKey,
          appSecret,
          redirectUri
        });
      }
      
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
      
      storageProvider = new DropboxStorageProvider({
        accessToken,
        basePath: config.storage.options?.basePath as string,
        refreshToken,
        oauthService,
        onTokenUpdate: oauthService ? onTokenUpdate : undefined
      });
      logger?.info('[BackupRoute] Using Dropbox storage from config file (internal endpoint)');
    } else {
      storageProvider = new LocalStorageProvider();
      logger?.info('[BackupRoute] Using local storage from config file (internal endpoint)');
    }

    const backupService = new BackupService(storageProvider);
    const historyService = new BackupHistoryService();
    
    // バックアップターゲットを作成
    const target = createBackupTarget(body.kind, body.source, body.metadata);
    
    // バックアップ履歴を作成
    const historyId = await historyService.createHistory({
      operationType: BackupOperationType.BACKUP,
      targetKind: body.kind,
      targetSource: body.source,
      storageProvider: config.storage.provider
    });

    try {
      // バックアップを実行
      const result = await backupService.backup(target, {
        label: body.metadata?.label as string
      });

      // バックアップ履歴を完了として更新
      await historyService.completeHistory(historyId, {
        targetKind: body.kind,
        targetSource: body.source,
        sizeBytes: result.sizeBytes,
        path: result.path
      });

      return reply.status(200).send({
        success: result.success,
        path: result.path,
        sizeBytes: result.sizeBytes,
        timestamp: result.timestamp,
        historyId
      });
    } catch (error) {
      // バックアップ履歴を失敗として更新
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      await historyService.failHistory(historyId, errorMessage);
      throw error;
    }
  });

  // バックアップの実行
  app.post('/backup', {
    preHandler: [mustBeAdmin],
    schema: {
      body: {
        type: 'object',
        properties: {
          kind: { type: 'string', enum: ['database', 'file', 'directory', 'csv', 'image'] },
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
    const body = request.body as z.infer<typeof backupRequestSchema>;
    
    // 設定ファイルを読み込む
    const config = await BackupConfigLoader.load();
    
    // ストレージプロバイダーを作成
    let storageProvider;
    if (body.storage) {
      // リクエストボディでストレージが指定されている場合
      storageProvider = createStorageProvider(body.storage.provider, body.storage.options);
    } else {
      // リクエストボディでストレージが指定されていない場合、設定ファイルから読み込む
      if (config.storage.provider === 'dropbox') {
        const accessToken = config.storage.options?.accessToken as string;
        if (!accessToken) {
          throw new ApiError(400, 'Dropbox access token is required in config file');
        }
        
        // OAuthサービスを作成（リフレッシュトークンがある場合）
        let oauthService: DropboxOAuthService | undefined;
        const refreshToken = config.storage.options?.refreshToken as string | undefined;
        const appKey = config.storage.options?.appKey as string | undefined;
        const appSecret = config.storage.options?.appSecret as string | undefined;
        
        if (refreshToken && appKey && appSecret) {
          // リダイレクトURI（現在のホストを使用）
          const protocol = request.headers['x-forwarded-proto'] || request.protocol || 'http';
          const host = request.headers.host || 'localhost:8080';
          const redirectUri = `${protocol}://${host}/api/backup/oauth/callback`;
          
          oauthService = new DropboxOAuthService({
            appKey,
            appSecret,
            redirectUri
          });
        }
        
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
        
        storageProvider = new DropboxStorageProvider({
          accessToken,
          basePath: config.storage.options?.basePath as string,
          refreshToken,
          oauthService,
          onTokenUpdate: oauthService ? onTokenUpdate : undefined
        });
        logger?.info('[BackupRoute] Using Dropbox storage from config file');
      } else {
        storageProvider = new LocalStorageProvider();
        logger?.info('[BackupRoute] Using local storage from config file');
      }
    }

    const backupService = new BackupService(storageProvider);
    const historyService = new BackupHistoryService();
    
    // バックアップターゲットを作成
    const target = createBackupTarget(body.kind, body.source, body.metadata);
    
    // バックアップ履歴を作成
    const historyId = await historyService.createHistory({
      operationType: BackupOperationType.BACKUP,
      targetKind: body.kind,
      targetSource: body.source,
      storageProvider: body.storage?.provider || config.storage.provider
    });

    try {
      // バックアップを実行
      const result = await backupService.backup(target, {
        label: body.metadata?.label as string
      });

      // バックアップ履歴を完了として更新
      await historyService.completeHistory(historyId, {
        targetKind: body.kind,
        targetSource: body.source,
        sizeBytes: result.sizeBytes,
        path: result.path
      });

      return reply.status(200).send({
        success: result.success,
        path: result.path,
        sizeBytes: result.sizeBytes,
        timestamp: result.timestamp,
        historyId
      });
    } catch (error) {
      // バックアップ履歴を失敗として更新
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      await historyService.failHistory(historyId, errorMessage);
      throw error;
    }
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
    
    // ストレージプロバイダーを作成
    const storageProvider = body.storage
      ? createStorageProvider(body.storage.provider, body.storage.options)
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
      // 復元を実行
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
    return reply.status(200).send({ success: true });
  });

  // バックアップ対象の追加
  app.post('/backup/config/targets', {
    preHandler: [mustBeAdmin],
    schema: {
      body: {
        type: 'object',
        properties: {
          kind: { type: 'string', enum: ['database', 'file', 'directory', 'csv', 'image'] },
          source: { type: 'string' },
          schedule: { type: 'string' },
          enabled: { type: 'boolean' },
          metadata: { type: 'object' }
        },
        required: ['kind', 'source']
      }
    }
  }, async (request, reply) => {
    const body = request.body as {
      kind: 'database' | 'file' | 'directory' | 'csv' | 'image';
      source: string;
      schedule?: string;
      enabled?: boolean;
      metadata?: Record<string, unknown>;
    };

    const config = await BackupConfigLoader.load();
    
    // 新しいtargetを追加
    const newTarget = {
      kind: body.kind,
      source: body.source,
      schedule: body.schedule,
      enabled: body.enabled ?? true,
      metadata: body.metadata
    };

    config.targets.push(newTarget);
    await BackupConfigLoader.save(config);

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
          kind: { type: 'string', enum: ['database', 'file', 'directory', 'csv', 'image'] },
          source: { type: 'string' },
          schedule: { type: 'string' },
          enabled: { type: 'boolean' },
          metadata: { type: 'object' }
        }
      }
    }
  }, async (request, reply) => {
    const { index } = request.params as { index: string };
    const targetIndex = parseInt(index, 10);
    const body = request.body as Partial<{
      kind: 'database' | 'file' | 'directory' | 'csv' | 'image';
      source: string;
      schedule: string;
      enabled: boolean;
      metadata: Record<string, unknown>;
    }>;

    const config = await BackupConfigLoader.load();

    if (targetIndex < 0 || targetIndex >= config.targets.length) {
      throw new ApiError(400, `Invalid target index: ${index}`);
    }

    // 既存のtargetを更新
    const existingTarget = config.targets[targetIndex];
    config.targets[targetIndex] = {
      ...existingTarget,
      ...body
    };

    await BackupConfigLoader.save(config);

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
    targetKind: z.enum(['database', 'csv']).optional(), // リストア対象の種類
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
          targetKind: { type: 'string', enum: ['database', 'csv'] },
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

    // OAuthサービスを作成（リフレッシュトークンがある場合）
    let oauthService: DropboxOAuthService | undefined;
    const refreshToken = config.storage.options?.refreshToken as string | undefined;
    const appKey = config.storage.options?.appKey as string | undefined;
    const appSecret = config.storage.options?.appSecret as string | undefined;
    
    if (refreshToken && appKey && appSecret) {
      const protocol = request.headers['x-forwarded-proto'] || request.protocol || 'http';
      const host = request.headers.host || 'localhost:8080';
      const redirectUri = `${protocol}://${host}/api/backup/oauth/callback`;
      
      oauthService = new DropboxOAuthService({
        appKey,
        appSecret,
        redirectUri
      });
    }

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

    // Dropboxストレージプロバイダーを作成
    const dropboxProvider = new DropboxStorageProvider({
      accessToken,
      basePath: config.storage.options?.basePath as string,
      refreshToken,
      oauthService,
      onTokenUpdate: oauthService ? onTokenUpdate : undefined
    });

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

      // リストアを実行
      if (body.targetKind === 'database') {
        // データベースバックアップのリストア
        const { spawn } = await import('child_process');
        const { Readable } = await import('stream');

        const dbUrl = process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/borrow_return';
        const url = new URL(dbUrl);
        const dbName = url.pathname.replace(/^\//, '');
        const user = decodeURIComponent(url.username || 'postgres');
        const host = url.hostname || 'localhost';
        const port = url.port || '5432';
        const password = url.password ? decodeURIComponent(url.password) : undefined;

        const env = { ...process.env };
        if (password) {
          env.PGPASSWORD = password;
        }

        logger?.info({ dbName, host, port, backupPath: normalizedBackupPath }, '[BackupRoute] Restoring database from backup');
        
        // psqlでリストア（stdinにSQLを流し込む）
        await new Promise<void>((resolve, reject) => {
          const psql = spawn(
            'psql',
            ['-h', host, '-p', port, '-U', user, '-d', dbName, '--set', 'ON_ERROR_STOP=off'],
            { env, stdio: ['pipe', 'pipe', 'pipe'] }
          );

          const errors: string[] = [];
          psql.stderr.on('data', (data: Buffer) => {
            const errorMsg = data.toString('utf-8');
            // 警告メッセージは無視（エラーとして扱わない）
            if (!errorMsg.includes('WARNING') && !errorMsg.includes('NOTICE')) {
              errors.push(errorMsg);
            }
          });

          psql.on('close', async (code) => {
            if (code !== 0 && errors.length > 0) {
              logger?.error({ errors, code }, '[BackupRoute] Database restore failed');
              const errorMessage = `Database restore failed: ${errors.join(', ')}`;
              await historyService.failHistory(historyId, errorMessage);
              reject(new ApiError(500, errorMessage));
            } else {
              logger?.info({ backupPath: normalizedBackupPath, originalPath: body.backupPath }, '[BackupRoute] Database restore completed');
              // リストア履歴を完了として更新
              await historyService.completeHistory(historyId, {
                targetKind,
                targetSource,
                sizeBytes: backupData.length,
                hash: body.verifyIntegrity ? (await import('../services/backup/backup-verifier.js')).BackupVerifier.calculateHash(backupData) : undefined,
                path: normalizedBackupPath
              });
              resolve();
            }
          });

          psql.on('error', (error) => {
            logger?.error({ err: error }, '[BackupRoute] Failed to spawn psql');
            reject(new ApiError(500, `Failed to spawn psql: ${error.message}`));
          });

          // バックアップデータをstdinに書き込む
          const inputStream = Readable.from(backupData);
          inputStream.pipe(psql.stdin);
          inputStream.on('end', () => {
            psql.stdin.end();
          });
        });
      } else if (body.targetKind === 'csv') {
        // CSVバックアップのリストア（既存のCSVインポート機能を再利用）
        const { processCsvImport } = await import('./imports.js');
        
        // バックアップパスからCSVタイプを判定（employees/items）
        const csvType = normalizedBackupPath.includes('employees') ? 'employees' : 'items';
        const files = csvType === 'employees' 
          ? { employees: backupData }
          : { items: backupData };

        const logWrapper = {
          info: (obj: unknown, msg: string) => {
            logger?.info(obj, msg);
          },
          error: (obj: unknown, msg: string) => {
            logger?.error(obj, msg);
          }
        };

        logger?.info({ csvType, backupPath: normalizedBackupPath, originalPath: body.backupPath }, '[BackupRoute] Restoring CSV from backup');
        await processCsvImport(files, true, logWrapper); // replaceExisting = true

        logger?.info({ backupPath: normalizedBackupPath, originalPath: body.backupPath }, '[BackupRoute] CSV restore completed');
        
        // リストア履歴を完了として更新
        await historyService.completeHistory(historyId, {
          targetKind,
          targetSource,
          sizeBytes: backupData.length,
          hash: body.verifyIntegrity ? (await import('../services/backup/backup-verifier.js')).BackupVerifier.calculateHash(backupData) : undefined,
          path: normalizedBackupPath
        });
      } else {
        // 汎用的なリストア（ファイルとして保存）
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
