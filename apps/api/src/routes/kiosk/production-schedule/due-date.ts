import type { FastifyInstance } from 'fastify';

import { upsertProductionScheduleDueDate } from '../../../services/production-schedule/production-schedule-command.service.js';
import {
  productionScheduleDueDateBodySchema,
  productionScheduleDueDateParamsSchema,
  toLegacyLocationKeyFromDeviceScope,
  type KioskRouteDeps
} from './shared.js';
import { TERMINAL_ROUTE_RATE_LIMIT } from '../../../lib/terminal-route-rate-limit.js';

export async function registerProductionScheduleDueDateRoute(
  app: FastifyInstance,
  deps: KioskRouteDeps
): Promise<void> {
  app.put('/kiosk/production-schedule/:rowId/due-date', { config: { rateLimit: TERMINAL_ROUTE_RATE_LIMIT } }, async (request) => {
    const { clientDevice } = await deps.requireClientDevice(request.headers['x-client-key']);
    const locationScopeContext = deps.resolveLocationScopeContext(clientDevice);
    const deviceScopeKey = locationScopeContext.deviceScopeKey;
    const params = productionScheduleDueDateParamsSchema.parse(request.params);
    const body = productionScheduleDueDateBodySchema.parse(request.body);

    return upsertProductionScheduleDueDate({
      actorClientDeviceId: clientDevice.id,
      actorDeviceName: clientDevice.name,
      rowId: params.rowId,
      dueDateText: body.dueDate,
      locationKey: toLegacyLocationKeyFromDeviceScope(deviceScopeKey)
    });
  });
}
