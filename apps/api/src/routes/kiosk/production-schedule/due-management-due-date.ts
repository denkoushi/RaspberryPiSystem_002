import type { FastifyInstance } from 'fastify';

import { upsertProductionScheduleSeibanDueDate } from '../../../services/production-schedule/due-management-command.service.js';
import {
  resolveDueManagementStorageLocationKey,
  toDueManagementScopeFromContext
} from '../../../services/production-schedule/due-management-location-scope-adapter.service.js';
import {
  productionScheduleDueManagementSeibanDueDateBodySchema,
  productionScheduleDueManagementSeibanParamsSchema,
  type KioskRouteDeps
} from './shared.js';
import { TERMINAL_ROUTE_RATE_LIMIT } from '../../../lib/terminal-route-rate-limit.js';

export async function registerProductionScheduleDueManagementDueDateRoute(
  app: FastifyInstance,
  deps: KioskRouteDeps
): Promise<void> {
  app.put(
    '/kiosk/production-schedule/due-management/seiban/:fseiban/due-date',
    { config: { rateLimit: TERMINAL_ROUTE_RATE_LIMIT } },
    async (request) => {
      const { clientDevice } = await deps.requireClientDevice(request.headers['x-client-key']);
      const locationScopeContext = deps.resolveLocationScopeContext(clientDevice);
      const dueManagementScope = toDueManagementScopeFromContext(locationScopeContext);
      const locationKey = resolveDueManagementStorageLocationKey(dueManagementScope);
      const params = productionScheduleDueManagementSeibanParamsSchema.parse(request.params);
      const body = productionScheduleDueManagementSeibanDueDateBodySchema.parse(request.body);

      return upsertProductionScheduleSeibanDueDate({
        actorClientDeviceId: clientDevice.id,
        actorDeviceName: clientDevice.name,
        locationKey,
        fseiban: params.fseiban,
        dueDateText: body.dueDate
      });
    }
  );
}
