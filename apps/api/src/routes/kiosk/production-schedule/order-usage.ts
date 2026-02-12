import type { FastifyInstance } from 'fastify';

import { getProductionScheduleOrderUsage } from '../../../services/production-schedule/production-schedule-query.service.js';
import { productionScheduleQuerySchema, parseCsvList, type KioskRouteDeps } from './shared.js';

export async function registerProductionScheduleOrderUsageRoute(
  app: FastifyInstance,
  deps: KioskRouteDeps
): Promise<void> {
  app.get('/kiosk/production-schedule/order-usage', { config: { rateLimit: false } }, async (request) => {
    const { clientDevice } = await deps.requireClientDevice(request.headers['x-client-key']);
    const locationKey = deps.resolveLocationKey(clientDevice);
    const query = productionScheduleQuerySchema.parse(request.query);
    const resourceCds = parseCsvList(query.resourceCds);

    const usage = await getProductionScheduleOrderUsage({
      locationKey,
      resourceCds
    });

    return { usage };
  });
}
