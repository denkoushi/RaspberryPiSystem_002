import type { FastifyInstance } from 'fastify';

import { requireDueManagementToken } from '../../../lib/auth.js';

import { upsertProductionScheduleDueManagementPartProcessingType } from '../../../services/production-schedule/due-management-command.service.js';
import {
  resolveDueManagementStorageLocationKey,
  toDueManagementScopeFromContext
} from '../../../services/production-schedule/due-management-location-scope-adapter.service.js';
import {
  productionScheduleDueManagementPartParamsSchema,
  productionScheduleProcessingBodySchema,
  type KioskRouteDeps
} from './shared.js';
import { TERMINAL_ROUTE_RATE_LIMIT } from '../../../lib/terminal-route-rate-limit.js';

export async function registerProductionScheduleDueManagementProcessingRoute(
  app: FastifyInstance,
  deps: KioskRouteDeps
): Promise<void> {
  app.put(
    '/kiosk/production-schedule/due-management/seiban/:fseiban/parts/:fhincd/processing',
    { config: { rateLimit: TERMINAL_ROUTE_RATE_LIMIT } },
    async (request) => {
      const { clientDevice } = await deps.requireClientDevice(request.headers['x-client-key']);
      await requireDueManagementToken(request.headers['x-due-management-token'], clientDevice.id);
      const locationScopeContext = deps.resolveLocationScopeContext(clientDevice);
      const dueManagementScope = toDueManagementScopeFromContext(locationScopeContext);
      const locationKey = resolveDueManagementStorageLocationKey(dueManagementScope);
      const params = productionScheduleDueManagementPartParamsSchema.parse(request.params);
      const body = productionScheduleProcessingBodySchema.parse(request.body);

      return upsertProductionScheduleDueManagementPartProcessingType({
        locationKey,
        fseiban: params.fseiban,
        fhincd: params.fhincd,
        processingType: body.processingType ?? ''
      });
    }
  );
}
