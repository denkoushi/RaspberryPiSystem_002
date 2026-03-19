import type { FastifyInstance } from 'fastify';

import { ApiError } from '../../../lib/errors.js';
import { listDueManagementManualOrderOverview } from '../../../services/production-schedule/due-management-manual-order-overview.service.js';
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
