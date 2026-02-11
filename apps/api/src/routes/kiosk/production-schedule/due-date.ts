import type { FastifyInstance } from 'fastify';

import { upsertProductionScheduleDueDate } from '../../../services/production-schedule/production-schedule-command.service.js';
import {
  productionScheduleDueDateBodySchema,
  productionScheduleDueDateParamsSchema,
  type KioskRouteDeps
} from './shared.js';

export async function registerProductionScheduleDueDateRoute(
  app: FastifyInstance,
  deps: KioskRouteDeps
): Promise<void> {
  app.put('/kiosk/production-schedule/:rowId/due-date', { config: { rateLimit: false } }, async (request) => {
    const { clientDevice } = await deps.requireClientDevice(request.headers['x-client-key']);
    const locationKey = deps.resolveLocationKey(clientDevice);
    const params = productionScheduleDueDateParamsSchema.parse(request.params);
    const body = productionScheduleDueDateBodySchema.parse(request.body);

    return upsertProductionScheduleDueDate({
      rowId: params.rowId,
      dueDateText: body.dueDate,
      locationKey
    });
  });
}
