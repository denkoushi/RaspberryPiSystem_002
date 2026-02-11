import type { FastifyInstance } from 'fastify';

import { upsertProductionScheduleOrder } from '../../../services/production-schedule/production-schedule-command.service.js';
import {
  productionScheduleOrderBodySchema,
  productionScheduleOrderParamsSchema,
  type KioskRouteDeps
} from './shared.js';

export async function registerProductionScheduleOrderRoute(
  app: FastifyInstance,
  deps: KioskRouteDeps
): Promise<void> {
  app.put('/kiosk/production-schedule/:rowId/order', { config: { rateLimit: false } }, async (request) => {
    const { clientDevice } = await deps.requireClientDevice(request.headers['x-client-key']);
    const locationKey = deps.resolveLocationKey(clientDevice);
    const params = productionScheduleOrderParamsSchema.parse(request.params);
    const body = productionScheduleOrderBodySchema.parse(request.body);

    return upsertProductionScheduleOrder({
      rowId: params.rowId,
      resourceCd: body.resourceCd,
      orderNumber: body.orderNumber,
      locationKey
    });
  });
}
