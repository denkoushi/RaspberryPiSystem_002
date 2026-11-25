import type { FastifyInstance } from 'fastify';

import { getProductionScheduleProcessingTypeOptions } from '../../../services/production-schedule/production-schedule-settings.service.js';
import { toLegacyLocationKeyFromDeviceScope, type KioskRouteDeps } from './shared.js';
import { TERMINAL_ROUTE_RATE_LIMIT } from '../../../lib/terminal-route-rate-limit.js';

export async function registerProductionScheduleProcessingTypeOptionsRoute(
  app: FastifyInstance,
  deps: KioskRouteDeps
): Promise<void> {
  app.get('/kiosk/production-schedule/processing-type-options', { config: { rateLimit: TERMINAL_ROUTE_RATE_LIMIT } }, async (request) => {
    const { clientDevice } = await deps.requireClientDevice(request.headers['x-client-key']);
    const locationScopeContext = deps.resolveLocationScopeContext(clientDevice);
    const deviceScopeKey = locationScopeContext.deviceScopeKey;
    const settings = await getProductionScheduleProcessingTypeOptions(toLegacyLocationKeyFromDeviceScope(deviceScopeKey));
    return {
      options: settings.options
    };
  });
}
