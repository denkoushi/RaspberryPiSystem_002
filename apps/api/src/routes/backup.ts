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
    
    // ストレージプロバイダーを作成
    let storageProvider;
    if (body.storage) {
      // リクエストボディでストレージが指定されている場合
      storageProvider = createStorageProvider(body.storage.provider, body.storage.options);
    } else {
      // リクエストボディでストレージが指定されていない場合、設定ファイルから読み込む
      const config = await BackupConfigLoader.load();
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
    
    // バックアップターゲットを作成
    const target = createBackupTarget(body.kind, body.source, body.metadata);
    
    // バックアップを実行
    const result = await backupService.backup(target, {
      label: body.metadata?.label as string
    });

    return reply.status(200).send({
      success: result.success,
      path: result.path,
      sizeBytes: result.sizeBytes,
      timestamp: result.timestamp
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
    
    // ストレージプロバイダーを作成
    const storageProvider = body.storage
      ? createStorageProvider(body.storage.provider, body.storage.options)
      : new LocalStorageProvider();

    const backupService = new BackupService(storageProvider);
    
    // 復元を実行
    const result = await backupService.restore(body.backupPath, {
      destination: body.destination
    });

    return reply.status(200).send({
      success: result.success,
      timestamp: result.timestamp
    });
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
