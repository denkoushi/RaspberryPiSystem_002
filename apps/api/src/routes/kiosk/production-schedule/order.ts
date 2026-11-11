import type { FastifyInstance, FastifyRequest } from 'fastify';

import { env } from '../../../config/env.js';
import { ApiError } from '../../../lib/errors.js';
import { resolveSiteKeyForScopeKey } from '../../../lib/site-directory.js';
import { assertRegisteredDeviceScopeKey } from '../../../lib/manual-order-device-scope.js';
import { autoRankProductionScheduleOrder } from '../../../services/production-schedule/production-schedule-auto-rank.service.js';
import { upsertProductionScheduleOrder } from '../../../services/production-schedule/production-schedule-command.service.js';
import { canProxyTargetLocation } from '../shared.js';
import {
  productionScheduleAutoRankBodySchema,
  productionScheduleOrderBodySchema,
  productionScheduleOrderParamsSchema,
  toLegacyLocationKeyFromDeviceScope,
  type KioskRouteDeps
} from './shared.js';

export async function registerProductionScheduleOrderRoute(
  app: FastifyInstance,
  deps: KioskRouteDeps
): Promise<void> {
  const resolveOrderTarget = async <T extends { targetLocation?: string; targetDeviceScopeKey?: string }>(
    request: FastifyRequest,
    parseInput: () => T
  ) => {
    const { clientDevice } = await deps.requireClientDevice(request.headers['x-client-key']);
    const locationScopeContext = deps.resolveLocationScopeContext(clientDevice);
    const deviceScopeKey = locationScopeContext.deviceScopeKey;
    const body = parseInput();
    const actorLocation = toLegacyLocationKeyFromDeviceScope(deviceScopeKey);

    let targetLocation: string;

    if (env.KIOSK_MANUAL_ORDER_DEVICE_SCOPE_V2_ENABLED) {
      const requestedTargetDeviceScopeKey = body.targetDeviceScopeKey?.trim();
      const requestedTargetLocation = body.targetLocation?.trim();

      if (canProxyTargetLocation(locationScopeContext)) {
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
        targetLocation = resolveSiteKeyForScopeKey(requestedTargetDeviceScopeKey);
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
        targetLocation = locationScopeContext.siteKey;
      }
    } else {
      const requestedTargetLocation = body.targetLocation?.trim();
      if (
        requestedTargetLocation &&
        requestedTargetLocation !== actorLocation &&
        !canProxyTargetLocation(locationScopeContext)
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

    return { body, actorLocation, targetLocation, actorClientDeviceId: clientDevice.id };
  };

  app.put('/kiosk/production-schedule/:rowId/order', { config: { rateLimit: false } }, async (request) => {
    const { body: input, actorLocation, targetLocation, actorClientDeviceId } = await resolveOrderTarget(request, () => {
      const { rowId } = productionScheduleOrderParamsSchema.parse(request.params);
      return { ...productionScheduleOrderBodySchema.parse(request.body), rowId };
    });
    const { rowId, ...body } = input;

    request.log.info(
      {
        event: 'production_schedule_order_update',
        actorLocation,
        targetLocation,
        actorClientDeviceId,
        rowId,
        resourceCd: body.resourceCd,
        orderNumber: body.orderNumber,
        manualOrderDeviceScopeV2: env.KIOSK_MANUAL_ORDER_DEVICE_SCOPE_V2_ENABLED
      },
      'production schedule order updated'
    );

    return upsertProductionScheduleOrder({
      rowId,
      resourceCd: body.resourceCd,
      orderNumber: body.orderNumber,
      locationKey: targetLocation,
      actorLocationKey: actorLocation
    });
  });

  app.put('/kiosk/production-schedule/order/auto-rank', { config: { rateLimit: false } }, async (request) => {
    const { body, actorLocation, targetLocation, actorClientDeviceId } = await resolveOrderTarget(
      request, () => productionScheduleAutoRankBodySchema.parse(request.body)
    );
    request.log.info({
      event: 'production_schedule_order_auto_rank',
      actorLocation,
      targetLocation,
      actorClientDeviceId,
      resourceCd: body.resourceCd,
      count: body.assignments.length,
      assignments: body.assignments,
      manualOrderDeviceScopeV2: env.KIOSK_MANUAL_ORDER_DEVICE_SCOPE_V2_ENABLED
    }, 'production schedule order auto ranked');
    return autoRankProductionScheduleOrder({ ...body, locationKey: targetLocation, actorLocationKey: actorLocation });
  });
}
