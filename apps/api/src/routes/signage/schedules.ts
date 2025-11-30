import type { FastifyInstance } from 'fastify';
import { authorizeRoles } from '../../lib/auth.js';
import { SignageService } from '../../services/signage/index.js';
import { scheduleSchema, scheduleUpdateSchema, scheduleParamsSchema } from './schemas.js';

export function registerScheduleRoutes(app: FastifyInstance, signageService: SignageService): void {
  const canManage = authorizeRoles('ADMIN', 'MANAGER');

  // GET /api/signage/schedules - スケジュール一覧取得（認証不要、サイネージ用）
  app.get('/schedules', { config: { rateLimit: false } }, async () => {
    const schedules = await signageService.getSchedules();
    return { schedules };
  });

  // POST /api/signage/schedules - スケジュール作成（管理画面用）
  app.post('/schedules', { preHandler: canManage }, async (request) => {
    const body = scheduleSchema.parse(request.body);
    const schedule = await signageService.createSchedule(body);
    return { schedule };
  });

  // PUT /api/signage/schedules/:id - スケジュール更新（管理画面用）
  app.put('/schedules/:id', { preHandler: canManage }, async (request) => {
    const params = scheduleParamsSchema.parse(request.params);
    const body = scheduleUpdateSchema.parse(request.body);
    const schedule = await signageService.updateSchedule(params.id, body);
    return { schedule };
  });

  // DELETE /api/signage/schedules/:id - スケジュール削除（管理画面用）
  app.delete('/schedules/:id', { preHandler: canManage }, async (request) => {
    const params = scheduleParamsSchema.parse(request.params);
    await signageService.deleteSchedule(params.id);
    return { success: true };
  });
}

