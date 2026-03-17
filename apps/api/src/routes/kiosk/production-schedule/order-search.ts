import type { FastifyInstance } from 'fastify';

import { searchProductionScheduleOrders } from '../../../services/production-schedule/production-schedule-query.service.js';
import {
  parseCsvList,
  productionScheduleOrderSearchQuerySchema,
  toLegacyLocationKeyFromDeviceScope,
  type KioskRouteDeps
} from './shared.js';

export async function registerProductionScheduleOrderSearchRoute(
  app: FastifyInstance,
  deps: KioskRouteDeps
): Promise<void> {
  app.get('/kiosk/production-schedule/order-search', { config: { rateLimit: false } }, async (request) => {
    const { clientDevice } = await deps.requireClientDevice(request.headers['x-client-key']);
    const locationScopeContext = deps.resolveLocationScopeContext(clientDevice);
    const query = productionScheduleOrderSearchQuerySchema.parse(request.query);

    const result = await searchProductionScheduleOrders({
      locationKey: toLegacyLocationKeyFromDeviceScope(locationScopeContext.deviceScopeKey),
      siteKey: locationScopeContext.siteKey,
      resourceCds: parseCsvList(query.resourceCds),
      resourceCategory: query.resourceCategory,
      machineName: query.machineName?.trim(),
      productNoPrefix: query.productNoPrefix,
      partName: query.partName?.trim()
    });

    return result;
  });
}
