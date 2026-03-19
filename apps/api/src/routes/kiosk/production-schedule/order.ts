import type { FastifyInstance } from 'fastify';

import { ApiError } from '../../../lib/errors.js';
import { upsertProductionScheduleOrder } from '../../../services/production-schedule/production-schedule-command.service.js';
import {
  productionScheduleOrderBodySchema,
  productionScheduleOrderParamsSchema,
  toLegacyLocationKeyFromDeviceScope,
  type KioskRouteDeps
} from './shared.js';
import { canProxyTargetLocation } from '../shared.js';

export async function registerProductionScheduleOrderRoute(
  app: FastifyInstance,
  deps: KioskRouteDeps
): Promise<void> {
  app.put('/kiosk/production-schedule/:rowId/order', { config: { rateLimit: false } }, async (request) => {
    const { clientDevice, clientKey } = await deps.requireClientDevice(request.headers['x-client-key']);
    const locationScopeContext = deps.resolveLocationScopeContext(clientDevice);
    const deviceScopeKey = locationScopeContext.deviceScopeKey;
    const params = productionScheduleOrderParamsSchema.parse(request.params);
    const body = productionScheduleOrderBodySchema.parse(request.body);
    const actorLocation = toLegacyLocationKeyFromDeviceScope(deviceScopeKey);
    const requestedTargetLocation = body.targetLocation?.trim();

    if (
      requestedTargetLocation &&
      requestedTargetLocation !== actorLocation &&
      !canProxyTargetLocation(actorLocation)
    ) {
      throw new ApiError(
        403,
        'この端末では他ロケーションへの手動順番更新はできません',
        undefined,
        'TARGET_LOCATION_FORBIDDEN'
      );
    }

    const targetLocation = deps.resolveTargetLocation({
      requestedTargetLocation,
      actorLocation
    });

    request.log.info(
      {
        event: 'production_schedule_order_update',
        actorLocation,
        targetLocation,
        actorClientKey: clientKey,
        rowId: params.rowId,
        resourceCd: body.resourceCd,
        orderNumber: body.orderNumber
      },
      'production schedule order updated'
    );

    return upsertProductionScheduleOrder({
      rowId: params.rowId,
      resourceCd: body.resourceCd,
      orderNumber: body.orderNumber,
      locationKey: targetLocation,
      actorLocationKey: actorLocation
    });
  });
}
