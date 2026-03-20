import type { FastifyInstance } from 'fastify';

import { env } from '../../../config/env.js';
import { ApiError } from '../../../lib/errors.js';
import { resolveSiteKeyFromScopeKey } from '../../../lib/location-scope-resolver.js';
import { MANUAL_ORDER_LEGACY_SITE_BUCKET_KEY } from '../../../lib/manual-order-device-scope.js';
import {
  listDueManagementManualOrderOverview,
  listDueManagementManualOrderOverviewV2
} from '../../../services/production-schedule/due-management-manual-order-overview.service.js';
import { canProxyTargetLocation } from '../shared.js';
import {
  productionScheduleDueManagementManualOrderOverviewQuerySchema,
  toLegacyLocationKeyFromDeviceScope,
  type KioskRouteDeps
} from './shared.js';

export async function registerProductionScheduleDueManagementManualOrderOverviewRoute(
  app: FastifyInstance,
  deps: KioskRouteDeps
): Promise<void> {
  app.get(
    '/kiosk/production-schedule/due-management/manual-order-overview',
    { config: { rateLimit: false } },
    async (request) => {
      const { clientDevice } = await deps.requireClientDevice(request.headers['x-client-key']);
      const locationScopeContext = deps.resolveLocationScopeContext(clientDevice);
      const actorLocation = toLegacyLocationKeyFromDeviceScope(locationScopeContext.deviceScopeKey);
      const query = productionScheduleDueManagementManualOrderOverviewQuerySchema.parse(request.query);

      if (env.KIOSK_MANUAL_ORDER_DEVICE_SCOPE_V2_ENABLED) {
        const siteKey = query.siteKey?.trim();
        if (!siteKey) {
          throw new ApiError(400, 'siteKey は必須です', undefined, 'SITE_KEY_REQUIRED');
        }
        if (query.targetLocation?.trim()) {
          throw new ApiError(
            400,
            'targetLocation は使用できません。siteKey を指定してください',
            undefined,
            'TARGET_LOCATION_DEPRECATED'
          );
        }

        if (!canProxyTargetLocation(actorLocation) && siteKey !== locationScopeContext.siteKey) {
          throw new ApiError(
            403,
            'この端末では他工場の手動順番全体像を参照できません',
            undefined,
            'SITE_KEY_FORBIDDEN'
          );
        }

        const deviceScopeKey = query.deviceScopeKey?.trim();
        if (
          deviceScopeKey &&
          deviceScopeKey !== MANUAL_ORDER_LEGACY_SITE_BUCKET_KEY &&
          resolveSiteKeyFromScopeKey(deviceScopeKey) !== siteKey
        ) {
          throw new ApiError(
            400,
            'deviceScopeKey が siteKey と整合しません',
            undefined,
            'DEVICE_SCOPE_SITE_MISMATCH'
          );
        }

        const result = await listDueManagementManualOrderOverviewV2({
          siteKey,
          deviceScopeKey,
          resourceCd: query.resourceCd
        });
        return {
          actorLocation,
          siteKey: result.siteKey,
          deviceScopeKey: result.deviceScopeKey,
          registeredDeviceScopeKeys: result.registeredDeviceScopeKeys,
          devices: result.devices
        };
      }

      const requestedTargetLocation = query.targetLocation?.trim();

      if (
        requestedTargetLocation &&
        requestedTargetLocation !== actorLocation &&
        !canProxyTargetLocation(actorLocation)
      ) {
        throw new ApiError(
          403,
          'この端末では他ロケーションの手動順番全体像を参照できません',
          undefined,
          'TARGET_LOCATION_FORBIDDEN'
        );
      }

      const targetLocation = deps.resolveTargetLocation({
        requestedTargetLocation,
        actorLocation
      });
      const result = await listDueManagementManualOrderOverview({
        targetLocation,
        resourceCd: query.resourceCd
      });
      return {
        actorLocation,
        targetLocation: result.targetLocation,
        resources: result.resources
      };
    }
  );
}
