import type { FastifyInstance } from 'fastify';

import { env } from '../../../config/env.js';
import { ApiError } from '../../../lib/errors.js';
import { resolveSiteKeyFromScopeKey } from '../../../lib/location-scope-resolver.js';
import { assertRegisteredDeviceScopeKey } from '../../../lib/manual-order-device-scope.js';
import {
  deleteProductionScheduleOrderSplits,
  listProductionScheduleOrderSplitsForParent,
  replaceProductionScheduleOrderSplits,
  upsertProductionScheduleSplitDueDate,
  upsertProductionScheduleSplitOrder
} from '../../../services/production-schedule/order-split/production-schedule-order-split.service.js';
import {
  getProductionScheduleOrderSplitPilotStatus,
  isProductionScheduleOrderSplitEnabled
} from '../../../services/production-schedule/order-split/production-schedule-order-split-feature.js';
import {
  productionScheduleOrderSplitListParamsSchema,
  productionScheduleOrderSplitListQuerySchema,
  productionScheduleOrderSplitReplaceBodySchema,
  productionScheduleSplitDueDateBodySchema,
  productionScheduleSplitDueDateParamsSchema,
  productionScheduleSplitOrderBodySchema,
  productionScheduleSplitOrderParamsSchema
} from '../../../services/production-schedule/order-split/production-schedule-order-split.schemas.js';
import { resolveProductionScheduleAssignmentLocationKey } from './resolve-assignment-location-key.js';
import { canProxyTargetLocation } from '../shared.js';
import {
  toLegacyLocationKeyFromDeviceScope,
  type KioskRouteDeps
} from './shared.js';

function assertSplitFeatureEnabled(): void {
  if (!isProductionScheduleOrderSplitEnabled()) {
    throw new ApiError(403, '生産指示分割は無効です', undefined, 'FEATURE_DISABLED');
  }
}

async function resolveSplitMutationLocation(params: {
  deviceScopeKey: string;
  actorLocation: string;
  body: { targetDeviceScopeKey?: string; targetLocation?: string };
}): Promise<string> {
  const { deviceScopeKey, actorLocation, body } = params;

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
      return resolveSiteKeyFromScopeKey(requestedTargetDeviceScopeKey);
    }

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
    return resolveSiteKeyFromScopeKey(deviceScopeKey);
  }

  const requestedTargetLocation = body.targetLocation?.trim();
  if (
    requestedTargetLocation &&
    requestedTargetLocation !== actorLocation &&
    !canProxyTargetLocation(actorLocation)
  ) {
    throw new ApiError(
      403,
      'この端末では他ロケーションへの更新はできません',
      undefined,
      'TARGET_LOCATION_FORBIDDEN'
    );
  }
  return requestedTargetLocation && requestedTargetLocation.length > 0
    ? requestedTargetLocation
    : actorLocation;
}

export async function registerProductionScheduleOrderSplitRoutes(
  app: FastifyInstance,
  deps: KioskRouteDeps
): Promise<void> {
  app.get('/kiosk/production-schedule/order-split/status', { config: { rateLimit: false } }, async (request) => {
    await deps.requireClientDevice(request.headers['x-client-key']);
    const settings = await getProductionScheduleOrderSplitPilotStatus();
    return { settings };
  });

  app.get('/kiosk/production-schedule/:sourceRowId/splits', { config: { rateLimit: false } }, async (request) => {
    assertSplitFeatureEnabled();
    const { clientDevice } = await deps.requireClientDevice(request.headers['x-client-key']);
    const locationScopeContext = deps.resolveLocationScopeContext(clientDevice);
    const deviceScopeKey = locationScopeContext.deviceScopeKey;
    const actorLocation = toLegacyLocationKeyFromDeviceScope(deviceScopeKey);
    const params = productionScheduleOrderSplitListParamsSchema.parse(request.params);
    const query = productionScheduleOrderSplitListQuerySchema.parse(request.query);
    const locationKey = await resolveProductionScheduleAssignmentLocationKey({
      actorDeviceScopeKey: actorLocation,
      targetDeviceScopeKey: query.targetDeviceScopeKey
    });

    const result = await listProductionScheduleOrderSplitsForParent(params.sourceRowId, locationKey);
    return {
      ...result,
      actorLocation
    };
  });

  app.put('/kiosk/production-schedule/:sourceRowId/splits', { config: { rateLimit: false } }, async (request) => {
    assertSplitFeatureEnabled();
    const { clientDevice, clientKey } = await deps.requireClientDevice(request.headers['x-client-key']);
    const locationScopeContext = deps.resolveLocationScopeContext(clientDevice);
    const deviceScopeKey = locationScopeContext.deviceScopeKey;
    const actorLocation = toLegacyLocationKeyFromDeviceScope(deviceScopeKey);
    const params = productionScheduleOrderSplitListParamsSchema.parse(request.params);
    const body = productionScheduleOrderSplitReplaceBodySchema.parse(request.body);
    const locationKey = await resolveSplitMutationLocation({
      deviceScopeKey,
      actorLocation,
      body
    });

    return replaceProductionScheduleOrderSplits({
      parentCsvDashboardRowId: params.sourceRowId,
      locationKey,
      resourceCd: body.resourceCd,
      items: body.items,
      audit: {
        actorClientKey: clientKey,
        actorLocation,
        targetLocation: locationKey,
        siteKey: resolveSiteKeyFromScopeKey(locationKey),
        requestId: request.id
      }
    });
  });

  app.delete('/kiosk/production-schedule/:sourceRowId/splits', { config: { rateLimit: false } }, async (request) => {
    assertSplitFeatureEnabled();
    const { clientDevice, clientKey } = await deps.requireClientDevice(request.headers['x-client-key']);
    const locationScopeContext = deps.resolveLocationScopeContext(clientDevice);
    const deviceScopeKey = locationScopeContext.deviceScopeKey;
    const actorLocation = toLegacyLocationKeyFromDeviceScope(deviceScopeKey);
    const params = productionScheduleOrderSplitListParamsSchema.parse(request.params);
    const query = productionScheduleOrderSplitListQuerySchema.parse(request.query);
    const locationKey = await resolveSplitMutationLocation({
      deviceScopeKey,
      actorLocation,
      body: query
    });

    return deleteProductionScheduleOrderSplits({
      parentCsvDashboardRowId: params.sourceRowId,
      audit: {
        actorClientKey: clientKey,
        actorLocation,
        targetLocation: locationKey,
        siteKey: resolveSiteKeyFromScopeKey(locationKey),
        requestId: request.id
      }
    });
  });

  app.put('/kiosk/production-schedule/splits/:splitId/order', { config: { rateLimit: false } }, async (request) => {
    assertSplitFeatureEnabled();
    const { clientDevice, clientKey } = await deps.requireClientDevice(request.headers['x-client-key']);
    const locationScopeContext = deps.resolveLocationScopeContext(clientDevice);
    const deviceScopeKey = locationScopeContext.deviceScopeKey;
    const actorLocation = toLegacyLocationKeyFromDeviceScope(deviceScopeKey);
    const params = productionScheduleSplitOrderParamsSchema.parse(request.params);
    const body = productionScheduleSplitOrderBodySchema.parse(request.body);
    const locationKey = await resolveSplitMutationLocation({
      deviceScopeKey,
      actorLocation,
      body
    });

    return upsertProductionScheduleSplitOrder({
      splitId: params.splitId,
      resourceCd: body.resourceCd,
      orderNumber: body.orderNumber,
      locationKey,
      actorLocationKey: actorLocation,
      audit: {
        actorClientKey: clientKey,
        actorLocation,
        targetLocation: locationKey,
        siteKey: resolveSiteKeyFromScopeKey(locationKey),
        requestId: request.id
      }
    });
  });

  app.put('/kiosk/production-schedule/splits/:splitId/due-date', { config: { rateLimit: false } }, async (request) => {
    assertSplitFeatureEnabled();
    const { clientDevice, clientKey } = await deps.requireClientDevice(request.headers['x-client-key']);
    const locationScopeContext = deps.resolveLocationScopeContext(clientDevice);
    const deviceScopeKey = locationScopeContext.deviceScopeKey;
    const actorLocation = toLegacyLocationKeyFromDeviceScope(deviceScopeKey);
    const params = productionScheduleSplitDueDateParamsSchema.parse(request.params);
    const body = productionScheduleSplitDueDateBodySchema.parse(request.body);

    return upsertProductionScheduleSplitDueDate({
      splitId: params.splitId,
      dueDateText: body.dueDate,
      audit: {
        actorClientKey: clientKey,
        actorLocation,
        targetLocation: resolveSiteKeyFromScopeKey(deviceScopeKey),
        siteKey: locationScopeContext.siteKey,
        requestId: request.id
      }
    });
  });
}
