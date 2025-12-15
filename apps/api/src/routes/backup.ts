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
function createStorageProvider(provider: string, options?: Record<string, unknown>) {
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
        basePath: options?.basePath as string
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
        storageProvider = new DropboxStorageProvider({
          accessToken,
          basePath: config.storage.options?.basePath as string
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
}
