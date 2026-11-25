import type { FastifyInstance } from 'fastify';

import { getProductionScheduleProgressOverview } from '../../../services/production-schedule/progress-overview-query.service.js';
import { toLegacyLocationKeyFromDeviceScope, type KioskRouteDeps } from './shared.js';
import { TERMINAL_ROUTE_RATE_LIMIT } from '../../../lib/terminal-route-rate-limit.js';

export async function registerProductionScheduleProgressOverviewRoute(
  app: FastifyInstance,
  deps: KioskRouteDeps
): Promise<void> {
  app.get('/kiosk/production-schedule/progress-overview', { config: { rateLimit: TERMINAL_ROUTE_RATE_LIMIT } }, async (request) => {
    const { clientDevice } = await deps.requireClientDevice(request.headers['x-client-key']);
    const locationScopeContext = deps.resolveLocationScopeContext(clientDevice);
    const deviceScopeKey = locationScopeContext.deviceScopeKey;
    const overview = await getProductionScheduleProgressOverview(toLegacyLocationKeyFromDeviceScope(deviceScopeKey));
    return {
      overview
    };
  });
}
