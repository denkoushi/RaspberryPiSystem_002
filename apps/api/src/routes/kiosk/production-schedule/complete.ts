import type { FastifyInstance } from 'fastify';

import { completeProductionScheduleRow } from '../../../services/production-schedule/production-schedule-command.service.js';
import { productionScheduleCompleteParamsSchema, type KioskRouteDeps } from './shared.js';

export async function registerProductionScheduleCompleteRoute(
  app: FastifyInstance,
  deps: KioskRouteDeps
): Promise<void> {
  app.put('/kiosk/production-schedule/:rowId/complete', { config: { rateLimit: false } }, async (request) => {
    const { clientDevice } = await deps.requireClientDevice(request.headers['x-client-key']);
    const locationKey = deps.resolveLocationKey(clientDevice);
    const params = productionScheduleCompleteParamsSchema.parse(request.params);

    return completeProductionScheduleRow({
      rowId: params.rowId,
      locationKey
    });
  });
}
