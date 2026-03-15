import type { FastifyInstance } from 'fastify';

import { getProductionScheduleProgressOverview } from '../../../services/production-schedule/progress-overview-query.service.js';
import type { KioskRouteDeps } from './shared.js';

export async function registerProductionScheduleProgressOverviewRoute(
  app: FastifyInstance,
  deps: KioskRouteDeps
): Promise<void> {
  app.get('/kiosk/production-schedule/progress-overview', { config: { rateLimit: false } }, async (request) => {
    const { clientDevice } = await deps.requireClientDevice(request.headers['x-client-key']);
    const locationScopeContext = deps.resolveLocationScopeContext(clientDevice);
    const overview = await getProductionScheduleProgressOverview(locationScopeContext.deviceScopeKey);
    return {
      overview
    };
  });
}
