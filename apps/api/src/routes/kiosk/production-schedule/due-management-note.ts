import type { FastifyInstance } from 'fastify';

import { requireDueManagementToken } from '../../../lib/auth.js';

import { upsertProductionScheduleDueManagementPartNote } from '../../../services/production-schedule/due-management-command.service.js';
import {
  resolveDueManagementStorageLocationKey,
  toDueManagementScopeFromContext
} from '../../../services/production-schedule/due-management-location-scope-adapter.service.js';
import {
  productionScheduleDueManagementPartParamsSchema,
  productionScheduleNoteBodySchema,
  type KioskRouteDeps
} from './shared.js';
import { TERMINAL_ROUTE_RATE_LIMIT } from '../../../lib/terminal-route-rate-limit.js';

export async function registerProductionScheduleDueManagementNoteRoute(
  app: FastifyInstance,
  deps: KioskRouteDeps
): Promise<void> {
  app.put(
    '/kiosk/production-schedule/due-management/seiban/:fseiban/parts/:fhincd/note',
    { config: { rateLimit: TERMINAL_ROUTE_RATE_LIMIT } },
    async (request) => {
      const { clientDevice } = await deps.requireClientDevice(request.headers['x-client-key']);
      await requireDueManagementToken(request.headers['x-due-management-token'], clientDevice.id);
      const locationScopeContext = deps.resolveLocationScopeContext(clientDevice);
      const dueManagementScope = toDueManagementScopeFromContext(locationScopeContext);
      const locationKey = resolveDueManagementStorageLocationKey(dueManagementScope);
      const params = productionScheduleDueManagementPartParamsSchema.parse(request.params);
      const body = productionScheduleNoteBodySchema.parse(request.body);
      return upsertProductionScheduleDueManagementPartNote({
        locationKey,
        fseiban: params.fseiban,
        fhincd: params.fhincd,
        note: body.note
      });
    }
  );
}
