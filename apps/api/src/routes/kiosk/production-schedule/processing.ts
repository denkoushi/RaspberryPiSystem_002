import type { FastifyInstance } from 'fastify';

import { upsertProductionScheduleProcessingType } from '../../../services/production-schedule/production-schedule-command.service.js';
import {
  productionScheduleProcessingBodySchema,
  productionScheduleProcessingParamsSchema,
  toLegacyLocationKeyFromDeviceScope,
  type KioskRouteDeps
} from './shared.js';
import { TERMINAL_ROUTE_RATE_LIMIT } from '../../../lib/terminal-route-rate-limit.js';

export async function registerProductionScheduleProcessingRoute(
  app: FastifyInstance,
  deps: KioskRouteDeps
): Promise<void> {
  app.put('/kiosk/production-schedule/:rowId/processing', { config: { rateLimit: TERMINAL_ROUTE_RATE_LIMIT } }, async (request) => {
    const { clientDevice } = await deps.requireClientDevice(request.headers['x-client-key']);
    const locationScopeContext = deps.resolveLocationScopeContext(clientDevice);
    const deviceScopeKey = locationScopeContext.deviceScopeKey;
    const params = productionScheduleProcessingParamsSchema.parse(request.params);
    const body = productionScheduleProcessingBodySchema.parse(request.body);

    return upsertProductionScheduleProcessingType({
      rowId: params.rowId,
      processingType: body.processingType ?? '',
      locationKey: toLegacyLocationKeyFromDeviceScope(deviceScopeKey)
    });
  });
}
