import type { FastifyInstance } from 'fastify';

import { listProductionScheduleResources } from '../../../services/production-schedule/production-schedule-query.service.js';
import type { KioskRouteDeps } from './shared.js';

export async function registerProductionScheduleResourcesRoute(
  app: FastifyInstance,
  deps: KioskRouteDeps
): Promise<void> {
  app.get('/kiosk/production-schedule/resources', { config: { rateLimit: false } }, async (request) => {
    await deps.requireClientDevice(request.headers['x-client-key']);
    const result = await listProductionScheduleResources();
    return {
      resources: result.resources,
      resourceNameMap: result.resourceNameMap
    };
  });
}
