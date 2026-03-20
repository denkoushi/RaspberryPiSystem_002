import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import { ApiError } from '../../../lib/errors.js';
import { listRegisteredDeviceScopeKeysForSite } from '../../../lib/manual-order-device-scope.js';
import { canProxyTargetLocation } from '../shared.js';
import { env } from '../../../config/env.js';
import {
  toLegacyLocationKeyFromDeviceScope,
  type KioskRouteDeps
} from './shared.js';

const querySchema = z.object({
  siteKey: z.string().min(1).max(100)
});

export async function registerProductionScheduleManualOrderSiteDevicesRoute(
  app: FastifyInstance,
  deps: KioskRouteDeps
): Promise<void> {
  app.get(
    '/kiosk/production-schedule/manual-order/site-devices',
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
          'この端末では他工場の端末一覧を参照できません',
          undefined,
          'SITE_KEY_FORBIDDEN'
        );
      }

      const deviceScopeKeys = await listRegisteredDeviceScopeKeysForSite(normalizedSiteKey);
      return { siteKey: normalizedSiteKey, deviceScopeKeys };
    }
  );
}
