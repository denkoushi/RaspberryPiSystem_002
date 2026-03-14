import type { FastifyInstance } from 'fastify';

import { listProductionScheduleResources } from '../../../services/production-schedule/production-schedule-query.service.js';
import type { KioskRouteDeps } from './shared.js';

export async function registerProductionScheduleResourcesRoute(
  app: FastifyInstance,
  deps: KioskRouteDeps
): Promise<void> {
  app.get('/kiosk/production-schedule/resources', { config: { rateLimit: false } }, async (request) => {
    const { clientDevice } = await deps.requireClientDevice(request.headers['x-client-key']);
    const locationKey = deps.resolveLocationKey(clientDevice);
    const result = await listProductionScheduleResources(locationKey);
    return {
      resources: result.resources,
      resourceNameMap: result.resourceNameMap
    };
  });
}
