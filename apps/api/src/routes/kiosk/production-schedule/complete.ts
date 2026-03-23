import type { FastifyInstance } from 'fastify';

import { env } from '../../../config/env.js';
import { completeProductionScheduleRow } from '../../../services/production-schedule/production-schedule-command.service.js';
import {
  productionScheduleCompleteParamsSchema,
  toLegacyLocationKeyFromDeviceScope,
  type KioskRouteDeps
} from './shared.js';

export async function registerProductionScheduleCompleteRoute(
  app: FastifyInstance,
  deps: KioskRouteDeps
): Promise<void> {
  app.put('/kiosk/production-schedule/:rowId/complete', { config: { rateLimit: false } }, async (request) => {
    const { clientDevice } = await deps.requireClientDevice(request.headers['x-client-key']);
    const locationScopeContext = deps.resolveLocationScopeContext(clientDevice);
    const deviceScopeKey = locationScopeContext.deviceScopeKey;
    const params = productionScheduleCompleteParamsSchema.parse(request.params);
    const debugSessionHeader = request.headers['x-cursor-debug-session'];
    const debugSessionId = typeof debugSessionHeader === 'string' ? debugSessionHeader : undefined;
    const assignmentLocationKey = env.KIOSK_MANUAL_ORDER_DEVICE_SCOPE_V2_ENABLED
      ? locationScopeContext.siteKey
      : toLegacyLocationKeyFromDeviceScope(deviceScopeKey);

    return completeProductionScheduleRow({
      rowId: params.rowId,
      locationKey: assignmentLocationKey,
      debugSessionId
    });
  });
}
