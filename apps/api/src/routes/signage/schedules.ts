import type { FastifyInstance } from 'fastify';
import { authorizeRoles } from '../../lib/auth.js';
import { SignageService } from '../../services/signage/index.js';
import { scheduleSchema, scheduleUpdateSchema, scheduleParamsSchema } from './schemas.js';

// Management responses use device IDs only.
function withoutLegacyTargets<T extends { targetClientKeys?: unknown }>(schedule: T): Omit<T, 'targetClientKeys'> {
  const { targetClientKeys: _legacy, ...rest } = schedule;
  void _legacy;
  return rest;
}

export function registerScheduleRoutes(app: FastifyInstance, signageService: SignageService): void {
  const canManage = authorizeRoles('ADMIN', 'MANAGER');

  // GET /api/signage/schedules - スケジュール一覧取得（認証不要、サイネージ用）
  app.get('/schedules', { config: { rateLimit: false } }, async () => {
    const schedules = await signageService.getSchedules();
    // 公開DTOは許可した表示項目だけを返し、端末の認証情報を含めない。
    return {
      schedules: schedules.map((schedule) => ({
        id: schedule.id,
        name: schedule.name,
        contentType: schedule.contentType,
        pdfId: schedule.pdfId,
        layoutConfig: schedule.layoutConfig,
        targetClientDeviceIds: schedule.targetClientDeviceIds,
        dayOfWeek: schedule.dayOfWeek,
        startTime: schedule.startTime,
        endTime: schedule.endTime,
        priority: schedule.priority,
        enabled: schedule.enabled,
      })),
    };
  });

  // GET /api/signage/schedules/management - 管理画面用（有効/無効を含む全件）
  app.get('/schedules/management', { preHandler: canManage }, async () => {
    const schedules = await signageService.listSchedulesForManagement();
    return { schedules: schedules.map(withoutLegacyTargets) };
  });

  // POST /api/signage/schedules - スケジュール作成（管理画面用）
  app.post('/schedules', { preHandler: canManage }, async (request) => {
    const body = scheduleSchema.parse(request.body);
    const schedule = await signageService.createSchedule(body);
    return { schedule: withoutLegacyTargets(schedule) };
  });

  // PUT /api/signage/schedules/:id - スケジュール更新（管理画面用）
  app.put('/schedules/:id', { preHandler: canManage }, async (request) => {
    const params = scheduleParamsSchema.parse(request.params);
    const body = scheduleUpdateSchema.parse(request.body);
    const schedule = await signageService.updateSchedule(params.id, body);
    return { schedule: withoutLegacyTargets(schedule) };
  });

  // DELETE /api/signage/schedules/:id - スケジュール削除（管理画面用）
  app.delete('/schedules/:id', { preHandler: canManage }, async (request) => {
    const params = scheduleParamsSchema.parse(request.params);
    await signageService.deleteSchedule(params.id);
    return { success: true };
  });
}

