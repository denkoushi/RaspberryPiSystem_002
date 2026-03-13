import type { FastifyInstance } from 'fastify';

import { emitDebugEvent } from '../../../lib/debug-sink.js';
import { listProductionScheduleRows } from '../../../services/production-schedule/production-schedule-query.service.js';
import { productionScheduleQuerySchema, parseCsvList, type KioskRouteDeps } from './shared.js';

export async function registerProductionScheduleListRoute(
  app: FastifyInstance,
  deps: KioskRouteDeps
): Promise<void> {
  app.get('/kiosk/production-schedule', { config: { rateLimit: false } }, async (request) => {
    const { clientDevice } = await deps.requireClientDevice(request.headers['x-client-key']);
    const locationKey = deps.resolveLocationKey(clientDevice);
    // #region agent log
    void emitDebugEvent({
      sessionId: '07ef10',
      runId: 'actual-hours-display-pre',
      hypothesisId: 'H3',
      location: 'routes/kiosk/production-schedule/list.ts:14',
      message: 'kiosk production-schedule request context',
      data: {
        clientName: clientDevice.name,
        clientLocation: clientDevice.location,
        resolvedLocationKey: locationKey
      },
      timestamp: Date.now()
    });
    // #endregion

    const query = productionScheduleQuerySchema.parse(request.query);
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 400;
    const rawQueryText = (query.q ?? query.productNo)?.trim() ?? '';
    const resourceCds = parseCsvList(query.resourceCds);
    const assignedOnlyCds = parseCsvList(query.resourceAssignedOnlyCds);
    const resourceCategory = query.resourceCategory;
    const hasNoteOnly = query.hasNoteOnly === true;
    const hasDueDateOnly = query.hasDueDateOnly === true;

    return listProductionScheduleRows({
      page,
      pageSize,
      queryText: rawQueryText,
      resourceCds,
      assignedOnlyCds,
      resourceCategory,
      hasNoteOnly,
      hasDueDateOnly,
      locationKey
    });
  });
}
