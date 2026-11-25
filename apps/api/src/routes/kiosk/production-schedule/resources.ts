import type { FastifyInstance } from 'fastify';

import { listProductionScheduleResources } from '../../../services/production-schedule/production-schedule-query.service.js';
import type { KioskRouteDeps } from './shared.js';
import { TERMINAL_ROUTE_RATE_LIMIT } from '../../../lib/terminal-route-rate-limit.js';

export async function registerProductionScheduleResourcesRoute(
  app: FastifyInstance,
  deps: KioskRouteDeps
): Promise<void> {
  app.get('/kiosk/production-schedule/resources', { config: { rateLimit: TERMINAL_ROUTE_RATE_LIMIT } }, async (request) => {
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
