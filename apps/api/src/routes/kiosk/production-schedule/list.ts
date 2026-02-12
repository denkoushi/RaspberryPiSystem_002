import type { FastifyInstance } from 'fastify';

import { listProductionScheduleRows } from '../../../services/production-schedule/production-schedule-query.service.js';
import { productionScheduleQuerySchema, parseCsvList, type KioskRouteDeps } from './shared.js';

export async function registerProductionScheduleListRoute(
  app: FastifyInstance,
  deps: KioskRouteDeps
): Promise<void> {
  app.get('/kiosk/production-schedule', { config: { rateLimit: false } }, async (request) => {
    const { clientDevice } = await deps.requireClientDevice(request.headers['x-client-key']);
    const locationKey = deps.resolveLocationKey(clientDevice);

    const query = productionScheduleQuerySchema.parse(request.query);
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 400;
    const rawQueryText = (query.q ?? query.productNo)?.trim() ?? '';
    const resourceCds = parseCsvList(query.resourceCds);
    const assignedOnlyCds = parseCsvList(query.resourceAssignedOnlyCds);
    const hasNoteOnly = query.hasNoteOnly === true;
    const hasDueDateOnly = query.hasDueDateOnly === true;

    return listProductionScheduleRows({
      page,
      pageSize,
      queryText: rawQueryText,
      resourceCds,
      assignedOnlyCds,
      hasNoteOnly,
      hasDueDateOnly,
      locationKey
    });
  });
}
