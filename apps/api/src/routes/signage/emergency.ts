import type { FastifyInstance } from 'fastify';
import { authorizeRoles } from '../../lib/auth.js';
import { SignageService } from '../../services/signage/index.js';
import { emergencySchema } from './schemas.js';

export function registerEmergencyRoutes(app: FastifyInstance, signageService: SignageService): void {
  const canManage = authorizeRoles('ADMIN', 'MANAGER');

  // GET /api/signage/emergency - 緊急表示情報取得（認証不要、サイネージ用）
  app.get('/emergency', { config: { rateLimit: false } }, async () => {
    const emergency = await signageService.getEmergency();
    return emergency || { enabled: false };
  });

  // POST /api/signage/emergency - 緊急表示設定（管理画面用）
  app.post('/emergency', { preHandler: canManage }, async (request) => {
    const body = emergencySchema.parse(request.body);
    const emergency = await signageService.setEmergency(body);
    return { emergency };
  });
}

