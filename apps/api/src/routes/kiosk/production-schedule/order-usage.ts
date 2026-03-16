import type { FastifyInstance } from 'fastify';

import { getProductionScheduleOrderUsage } from '../../../services/production-schedule/production-schedule-query.service.js';
import {
  productionScheduleQuerySchema,
  parseCsvList,
  toLegacyLocationKeyFromDeviceScope,
  type KioskRouteDeps
} from './shared.js';

export async function registerProductionScheduleOrderUsageRoute(
  app: FastifyInstance,
  deps: KioskRouteDeps
): Promise<void> {
  app.get('/kiosk/production-schedule/order-usage', { config: { rateLimit: false } }, async (request) => {
    const { clientDevice } = await deps.requireClientDevice(request.headers['x-client-key']);
    const locationScopeContext = deps.resolveLocationScopeContext(clientDevice);
    const deviceScopeKey = locationScopeContext.deviceScopeKey;
    const query = productionScheduleQuerySchema.parse(request.query);
    const resourceCds = parseCsvList(query.resourceCds);

    const usage = await getProductionScheduleOrderUsage({
      locationKey: toLegacyLocationKeyFromDeviceScope(deviceScopeKey),
      resourceCds
    });

    return { usage };
  });
}
