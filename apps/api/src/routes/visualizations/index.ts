import type { FastifyInstance } from 'fastify';
import { authorizeRoles } from '../../lib/auth.js';
import { VisualizationDashboardService } from '../../services/visualization/index.js';
import {
  visualizationDashboardCreateSchema,
  visualizationDashboardParamsSchema,
  visualizationDashboardUpdateSchema,
} from './schemas.js';

export function registerVisualizationRoutes(app: FastifyInstance): void {
  const visualizationService = new VisualizationDashboardService();
  const canManage = authorizeRoles('ADMIN', 'MANAGER');

  // GET /api/visualizations - 可視化ダッシュボード一覧取得
  app.get('/visualizations', { preHandler: canManage }, async (request) => {
    const query = request.query as Record<string, string | undefined>;
    const enabled = query.enabled !== undefined ? query.enabled === 'true' : undefined;
    const search = typeof query.search === 'string' ? query.search : undefined;

    const dashboards = await visualizationService.findAll({ enabled, search });
    return { dashboards };
  });

  // GET /api/visualizations/:id - 可視化ダッシュボード詳細取得
  app.get('/visualizations/:id', { preHandler: canManage }, async (request) => {
    const params = visualizationDashboardParamsSchema.parse(request.params);
    const dashboard = await visualizationService.findById(params.id);
    return { dashboard };
  });

  // POST /api/visualizations - 可視化ダッシュボード作成
  app.post('/visualizations', { preHandler: canManage }, async (request, reply) => {
    const body = visualizationDashboardCreateSchema.parse(request.body);
    const dashboard = await visualizationService.create(body);
    reply.code(201);
    return { dashboard };
  });

  // PUT /api/visualizations/:id - 可視化ダッシュボード更新
  app.put('/visualizations/:id', { preHandler: canManage }, async (request) => {
    const params = visualizationDashboardParamsSchema.parse(request.params);
    const body = visualizationDashboardUpdateSchema.parse(request.body);
    const dashboard = await visualizationService.update(params.id, body);
    return { dashboard };
  });

  // DELETE /api/visualizations/:id - 可視化ダッシュボード削除
  app.delete('/visualizations/:id', { preHandler: canManage }, async (request) => {
    const params = visualizationDashboardParamsSchema.parse(request.params);
    await visualizationService.delete(params.id);
    return { success: true };
  });
}
