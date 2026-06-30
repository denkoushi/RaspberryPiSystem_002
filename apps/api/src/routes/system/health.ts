import type { FastifyInstance } from 'fastify';

import { collectSystemHealth } from '../../services/system/system-health.service.js';
import { canViewSystemDiagnostics } from './access.js';

/**
 * 公開ヘルスチェックエンドポイント。
 * 詳細な内部状態は /system/health/detail に分離し、この公開版では最小情報だけ返す。
 */
export function registerSystemHealthRoute(app: FastifyInstance): void {
  app.get('/system/health', async (_request, reply) => {
    const health = await collectSystemHealth();
    return reply.status(health.statusCode).send({
      status: health.detail.status,
      timestamp: health.detail.timestamp,
    });
  });

  app.get('/system/health/detail', { preHandler: canViewSystemDiagnostics }, async (_request, reply) => {
    const health = await collectSystemHealth();
    return reply.status(health.statusCode).send(health.detail);
  });
}
