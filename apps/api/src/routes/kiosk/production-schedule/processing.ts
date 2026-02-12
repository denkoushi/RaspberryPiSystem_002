import type { FastifyInstance } from 'fastify';

import { upsertProductionScheduleProcessingType } from '../../../services/production-schedule/production-schedule-command.service.js';
import {
  productionScheduleProcessingBodySchema,
  productionScheduleProcessingParamsSchema,
  type KioskRouteDeps
} from './shared.js';

export async function registerProductionScheduleProcessingRoute(
  app: FastifyInstance,
  deps: KioskRouteDeps
): Promise<void> {
  app.put('/kiosk/production-schedule/:rowId/processing', { config: { rateLimit: false } }, async (request) => {
    const { clientDevice } = await deps.requireClientDevice(request.headers['x-client-key']);
    const locationKey = deps.resolveLocationKey(clientDevice);
    const params = productionScheduleProcessingParamsSchema.parse(request.params);
    const body = productionScheduleProcessingBodySchema.parse(request.body);

    return upsertProductionScheduleProcessingType({
      rowId: params.rowId,
      processingType: body.processingType ?? '',
      locationKey
    });
  });
}
