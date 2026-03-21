import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import { env } from '../../../config/env.js';
import { ApiError } from '../../../lib/errors.js';
import { resolveSiteKeyFromScopeKey } from '../../../lib/location-scope-resolver.js';
import { MANUAL_ORDER_LEGACY_SITE_BUCKET_KEY } from '../../../lib/manual-order-device-scope.js';
import {
  listManualOrderResourceAssignmentsForSite,
  replaceManualOrderResourceAssignmentsForDevice
} from '../../../services/production-schedule/manual-order-resource-assignment.service.js';
import { canProxyTargetLocation } from '../shared.js';
import { toLegacyLocationKeyFromDeviceScope, type KioskRouteDeps } from './shared.js';

const querySchema = z.object({
  siteKey: z.string().min(1).max(100)
});

const putBodySchema = z.object({
  siteKey: z.string().min(1).max(100),
  deviceScopeKey: z.string().min(1).max(200),
  resourceCds: z.array(z.string())
});

export async function registerProductionScheduleManualOrderResourceAssignmentsRoute(
  app: FastifyInstance,
  deps: KioskRouteDeps
): Promise<void> {
  app.get(
    '/kiosk/production-schedule/manual-order-resource-assignments',
    { config: { rateLimit: false } },
    async (request) => {
      if (!env.KIOSK_MANUAL_ORDER_DEVICE_SCOPE_V2_ENABLED) {
        throw new ApiError(404, 'このエンドポイントは無効です', undefined, 'FEATURE_DISABLED');
      }
      const { clientDevice } = await deps.requireClientDevice(request.headers['x-client-key']);
      const locationScopeContext = deps.resolveLocationScopeContext(clientDevice);
      const actorLocation = toLegacyLocationKeyFromDeviceScope(locationScopeContext.deviceScopeKey);
      const { siteKey } = querySchema.parse(request.query);
      const normalizedSiteKey = siteKey.trim();

      if (!canProxyTargetLocation(actorLocation) && normalizedSiteKey !== locationScopeContext.siteKey) {
        throw new ApiError(
          403,
          'この端末では他工場の資源割り当てを参照できません',
          undefined,
          'SITE_KEY_FORBIDDEN'
        );
      }

      const assignments = await listManualOrderResourceAssignmentsForSite(normalizedSiteKey);
      return { siteKey: normalizedSiteKey, assignments };
    }
  );

  app.put(
    '/kiosk/production-schedule/manual-order-resource-assignments',
    { config: { rateLimit: false } },
    async (request) => {
      if (!env.KIOSK_MANUAL_ORDER_DEVICE_SCOPE_V2_ENABLED) {
        throw new ApiError(404, 'このエンドポイントは無効です', undefined, 'FEATURE_DISABLED');
      }
      const { clientDevice } = await deps.requireClientDevice(request.headers['x-client-key']);
      const locationScopeContext = deps.resolveLocationScopeContext(clientDevice);
      const actorLocation = toLegacyLocationKeyFromDeviceScope(locationScopeContext.deviceScopeKey);
      const body = putBodySchema.parse(request.body);
      const normalizedSiteKey = body.siteKey.trim();
      const deviceScopeKey = body.deviceScopeKey.trim();

      if (!canProxyTargetLocation(actorLocation) && normalizedSiteKey !== locationScopeContext.siteKey) {
        throw new ApiError(
          403,
          'この端末では他工場の資源割り当てを更新できません',
          undefined,
          'SITE_KEY_FORBIDDEN'
        );
      }

      if (
        deviceScopeKey !== MANUAL_ORDER_LEGACY_SITE_BUCKET_KEY &&
        resolveSiteKeyFromScopeKey(deviceScopeKey) !== normalizedSiteKey
      ) {
        throw new ApiError(
          400,
          'deviceScopeKey が siteKey と整合しません',
          undefined,
          'DEVICE_SCOPE_SITE_MISMATCH'
        );
      }

      const result = await replaceManualOrderResourceAssignmentsForDevice({
        siteKey: normalizedSiteKey,
        deviceScopeKey,
        resourceCds: body.resourceCds
      });
      return { siteKey: normalizedSiteKey, ...result };
    }
  );
}
