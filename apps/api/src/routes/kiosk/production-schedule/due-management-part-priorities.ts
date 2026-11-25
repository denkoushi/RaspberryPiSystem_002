import type { FastifyInstance } from 'fastify';

import { requireDueManagementToken } from '../../../lib/auth.js';

import { upsertProductionSchedulePartPriorities } from '../../../services/production-schedule/due-management-command.service.js';
import {
  resolveDueManagementStorageLocationKey,
  toDueManagementScopeFromContext
} from '../../../services/production-schedule/due-management-location-scope-adapter.service.js';
import {
  productionScheduleDueManagementPartPrioritiesBodySchema,
  productionScheduleDueManagementSeibanParamsSchema,
  type KioskRouteDeps
} from './shared.js';
import { TERMINAL_ROUTE_RATE_LIMIT } from '../../../lib/terminal-route-rate-limit.js';

export async function registerProductionScheduleDueManagementPartPrioritiesRoute(
  app: FastifyInstance,
  deps: KioskRouteDeps
): Promise<void> {
  app.put(
    '/kiosk/production-schedule/due-management/seiban/:fseiban/part-priorities',
    { config: { rateLimit: TERMINAL_ROUTE_RATE_LIMIT } },
    async (request) => {
      const { clientDevice } = await deps.requireClientDevice(request.headers['x-client-key']);
      await requireDueManagementToken(request.headers['x-due-management-token'], clientDevice.id);
      const locationScopeContext = deps.resolveLocationScopeContext(clientDevice);
      const dueManagementScope = toDueManagementScopeFromContext(locationScopeContext);
      const locationKey = resolveDueManagementStorageLocationKey(dueManagementScope);
      const params = productionScheduleDueManagementSeibanParamsSchema.parse(request.params);
      const body = productionScheduleDueManagementPartPrioritiesBodySchema.parse(request.body);
      return upsertProductionSchedulePartPriorities({
        locationKey,
        fseiban: params.fseiban,
        orderedFhincds: body.orderedFhincds
      });
    }
  );
}
