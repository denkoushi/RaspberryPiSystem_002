import type { FastifyInstance } from 'fastify';

import { authorizeRoles } from '../../lib/auth.js';
import { BackupService } from '../../services/backup/backup.service.js';
import { LocalStorageProvider } from '../../services/backup/storage/local-storage.provider.js';

export async function registerBackupStorageMaintenanceRoutes(app: FastifyInstance): Promise<void> {
  const mustBeAdmin = authorizeRoles('ADMIN');

  // バックアップ一覧の取得
  app.get('/backup', {
    preHandler: [mustBeAdmin],
    schema: {
      querystring: {
        type: 'object',
        properties: {
          prefix: { type: 'string' },
          limit: { type: 'number' },
        },
      },
    },
  }, async (request, reply) => {
    const query = request.query as { prefix?: string; limit?: number };

    // デフォルトはローカルストレージを使用
    const storageProvider = new LocalStorageProvider();
    const backupService = new BackupService(storageProvider);

    const backups = await backupService.listBackups({
      prefix: query.prefix,
      limit: query.limit,
    });

    return reply.status(200).send({
      backups: backups.map((b) => ({
        path: b.path,
        sizeBytes: b.sizeBytes,
        modifiedAt: b.modifiedAt,
      })),
    });
  });

  // バックアップの削除
  // パスにスラッシュが含まれる可能性があるため、ワイルドカード（*）を使用
  app.delete('/backup/*', {
    preHandler: [mustBeAdmin],
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
}
