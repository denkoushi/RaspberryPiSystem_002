import type { FastifyInstance } from 'fastify';

import { env } from '../../../config/env.js';
import {
  completeProductionScheduleRow,
  setProductionScheduleRowCompletionIntent
} from '../../../services/production-schedule/production-schedule-command.service.js';
import {
  productionScheduleCompleteParamsSchema,
  productionScheduleCompletionIntentBodySchema,
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

  /** 明示的に完了/未完了へ。順位ボード等の主経路（トグル誤反転防止）。 */
  app.put('/kiosk/production-schedule/:rowId/completion', { config: { rateLimit: false } }, async (request) => {
    const { clientDevice } = await deps.requireClientDevice(request.headers['x-client-key']);
    const locationScopeContext = deps.resolveLocationScopeContext(clientDevice);
    const deviceScopeKey = locationScopeContext.deviceScopeKey;
    const params = productionScheduleCompleteParamsSchema.parse(request.params);
    const body = productionScheduleCompletionIntentBodySchema.parse(request.body ?? {});
    const debugSessionHeader = request.headers['x-cursor-debug-session'];
    const debugSessionId = typeof debugSessionHeader === 'string' ? debugSessionHeader : undefined;
    const assignmentLocationKey = env.KIOSK_MANUAL_ORDER_DEVICE_SCOPE_V2_ENABLED
      ? locationScopeContext.siteKey
      : toLegacyLocationKeyFromDeviceScope(deviceScopeKey);

    return setProductionScheduleRowCompletionIntent({
      rowId: params.rowId,
      locationKey: assignmentLocationKey,
      intent: body.intent,
      debugSessionId
    });
  });
}
