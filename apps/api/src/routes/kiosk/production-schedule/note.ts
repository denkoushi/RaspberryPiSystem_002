import type { FastifyInstance } from 'fastify';

import { upsertProductionScheduleNote } from '../../../services/production-schedule/production-schedule-command.service.js';
import {
  productionScheduleNoteBodySchema,
  productionScheduleNoteParamsSchema,
  type KioskRouteDeps
} from './shared.js';

export async function registerProductionScheduleNoteRoute(
  app: FastifyInstance,
  deps: KioskRouteDeps
): Promise<void> {
  app.put('/kiosk/production-schedule/:rowId/note', { config: { rateLimit: false } }, async (request) => {
    const { clientDevice } = await deps.requireClientDevice(request.headers['x-client-key']);
    const locationScopeContext = deps.resolveLocationScopeContext(clientDevice);
    const deviceScopeKey = locationScopeContext.deviceScopeKey;
    const params = productionScheduleNoteParamsSchema.parse(request.params);
    const body = productionScheduleNoteBodySchema.parse(request.body);

    return upsertProductionScheduleNote({
      rowId: params.rowId,
      note: body.note,
      locationKey: deviceScopeKey
    });
  });
}
