import type { FastifyInstance } from 'fastify';

import { listProductionScheduleResources } from '../../../services/production-schedule/production-schedule-query.service.js';
import type { KioskRouteDeps } from './shared.js';

export async function registerProductionScheduleResourcesRoute(
  app: FastifyInstance,
  deps: KioskRouteDeps
): Promise<void> {
  app.get('/kiosk/production-schedule/resources', { config: { rateLimit: false } }, async (request) => {
    const { clientDevice } = await deps.requireClientDevice(request.headers['x-client-key']);
    const locationScopeContext = deps.resolveLocationScopeContext(clientDevice);
    const result = await listProductionScheduleResources({
      siteKey: locationScopeContext.siteKey,
      deviceScopeKey: locationScopeContext.deviceScopeKey
    });
    return {
      resources: result.resources,
      resourceItems: result.resourceItems,
      resourceNameMap: result.resourceNameMap
    };
  });
}
