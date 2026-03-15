import type { FastifyInstance } from 'fastify';

import { upsertProductionScheduleDueManagementPartNote } from '../../../services/production-schedule/due-management-command.service.js';
import {
  productionScheduleDueManagementPartParamsSchema,
  productionScheduleNoteBodySchema,
  type KioskRouteDeps
} from './shared.js';

export async function registerProductionScheduleDueManagementNoteRoute(
  app: FastifyInstance,
  deps: KioskRouteDeps
): Promise<void> {
  app.put(
    '/kiosk/production-schedule/due-management/seiban/:fseiban/parts/:fhincd/note',
    { config: { rateLimit: false } },
    async (request) => {
      const { clientDevice } = await deps.requireClientDevice(request.headers['x-client-key']);
      const locationScopeContext = deps.resolveLocationScopeContext(clientDevice);
      const locationKey = locationScopeContext.deviceScopeKey;
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
