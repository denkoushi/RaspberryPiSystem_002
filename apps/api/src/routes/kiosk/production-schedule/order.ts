import type { FastifyInstance } from 'fastify';

import { env } from '../../../config/env.js';
import { ApiError } from '../../../lib/errors.js';
import { assertRegisteredDeviceScopeKey } from '../../../lib/manual-order-device-scope.js';
import { upsertProductionScheduleOrder } from '../../../services/production-schedule/production-schedule-command.service.js';
import { canProxyTargetLocation } from '../shared.js';
import {
  productionScheduleOrderBodySchema,
  productionScheduleOrderParamsSchema,
  toLegacyLocationKeyFromDeviceScope,
  type KioskRouteDeps
} from './shared.js';

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

    let targetLocation: string;

    if (env.KIOSK_MANUAL_ORDER_DEVICE_SCOPE_V2_ENABLED) {
      const requestedTargetDeviceScopeKey = body.targetDeviceScopeKey?.trim();
      const requestedTargetLocation = body.targetLocation?.trim();

      if (canProxyTargetLocation(actorLocation)) {
        if (!requestedTargetDeviceScopeKey) {
          throw new ApiError(
            400,
            'Mac端末では操作対象端末(targetDeviceScopeKey)の指定が必要です',
            undefined,
            'TARGET_DEVICE_SCOPE_KEY_REQUIRED'
          );
        }
        if (requestedTargetLocation) {
          throw new ApiError(
            400,
            'targetLocation は使用できません。targetDeviceScopeKey を指定してください',
            undefined,
            'TARGET_LOCATION_DEPRECATED'
          );
        }
        await assertRegisteredDeviceScopeKey(requestedTargetDeviceScopeKey);
        targetLocation = requestedTargetDeviceScopeKey;
      } else {
        if (requestedTargetDeviceScopeKey) {
          throw new ApiError(
            400,
            'この端末では targetDeviceScopeKey を指定できません',
            undefined,
            'TARGET_DEVICE_SCOPE_KEY_FORBIDDEN'
          );
        }
        if (requestedTargetLocation) {
          throw new ApiError(
            400,
            'この端末では targetLocation を指定できません',
            undefined,
            'TARGET_LOCATION_FORBIDDEN'
          );
        }
        targetLocation = actorLocation;
      }
    } else {
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
      targetLocation = deps.resolveTargetLocation({
        requestedTargetLocation,
        actorLocation
      });
    }

    request.log.info(
      {
        event: 'production_schedule_order_update',
        actorLocation,
        targetLocation,
        actorClientKey: clientKey,
        rowId: params.rowId,
        resourceCd: body.resourceCd,
        orderNumber: body.orderNumber,
        manualOrderDeviceScopeV2: env.KIOSK_MANUAL_ORDER_DEVICE_SCOPE_V2_ENABLED
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
