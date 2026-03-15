import type { FastifyInstance } from 'fastify';

import { getProductionScheduleProcessingTypeOptions } from '../../../services/production-schedule/production-schedule-settings.service.js';
import type { KioskRouteDeps } from './shared.js';

export async function registerProductionScheduleProcessingTypeOptionsRoute(
  app: FastifyInstance,
  deps: KioskRouteDeps
): Promise<void> {
  app.get('/kiosk/production-schedule/processing-type-options', { config: { rateLimit: false } }, async (request) => {
    const { clientDevice } = await deps.requireClientDevice(request.headers['x-client-key']);
    const locationScopeContext = deps.resolveLocationScopeContext(clientDevice);
    const deviceScopeKey = locationScopeContext.deviceScopeKey;
    const settings = await getProductionScheduleProcessingTypeOptions(deviceScopeKey);
    return {
      options: settings.options
    };
  });
}
