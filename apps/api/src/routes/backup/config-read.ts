import type { FastifyInstance } from 'fastify';

import { authorizeRoles } from '../../lib/auth.js';
import { ApiError } from '../../lib/errors.js';
import { BackupConfigLoader } from '../../services/backup/backup-config.loader.js';
import { getBackupTargetTemplates } from '../../services/backup/backup-target-templates.js';

export async function registerBackupConfigReadRoutes(app: FastifyInstance): Promise<void> {
  const mustBeAdmin = authorizeRoles('ADMIN');

  // 設定の取得
  app.get('/backup/config', {
    preHandler: [mustBeAdmin],
  }, async (_request, reply) => {
    const config = await BackupConfigLoader.load();
    return reply.status(200).send(config);
  });

  // 設定の健全性チェック（衝突・ドリフト検出）
  app.get('/backup/config/health', {
    preHandler: [mustBeAdmin],
  }, async (_request, reply) => {
    const health = await BackupConfigLoader.checkHealth();
    const statusCode = health.status === 'error' ? 500 : 200;
    return reply.status(statusCode).send(health);
  });

  // 設定の健全性チェック（内部用: localhostからのみ、認証不要）
  // backup/restore手順や事前チェックで利用するためのエンドポイント
  app.get('/backup/config/health/internal', {
    config: { rateLimit: false },
  }, async (request, reply) => {
    const remoteAddress = request.socket.remoteAddress || request.ip;
    if (remoteAddress !== '127.0.0.1' && remoteAddress !== '::1' && !remoteAddress?.startsWith('172.')) {
      throw new ApiError(403, 'Internal config health endpoint is only accessible from localhost');
    }
    const health = await BackupConfigLoader.checkHealth();
    const statusCode = health.status === 'error' ? 500 : 200;
    return reply.status(statusCode).send(health);
  });

  // バックアップ対象テンプレート一覧
  app.get('/backup/config/templates', {
    preHandler: [mustBeAdmin],
  }, async (_request, reply) => {
    return reply.status(200).send({ templates: getBackupTargetTemplates() });
  });
}
