import type { FastifyInstance } from 'fastify';

import { listEarliestEffectiveDueDateBySeiban } from '../../../services/production-schedule/due-date-resolution.service.js';
import { listDueManagementSummaries } from '../../../services/production-schedule/due-management-query.service.js';
import type { KioskRouteDeps } from './shared.js';

export async function registerProductionScheduleDueManagementSummaryRoute(
  app: FastifyInstance,
  deps: KioskRouteDeps
): Promise<void> {
  app.get('/kiosk/production-schedule/due-management/summary', { config: { rateLimit: false } }, async (request) => {
    const { clientDevice } = await deps.requireClientDevice(request.headers['x-client-key']);
    const locationKey = deps.resolveLocationKey(clientDevice);
    const summaries = await listDueManagementSummaries(locationKey);
    const effectiveDueDateMap = await listEarliestEffectiveDueDateBySeiban(summaries.map((item) => item.fseiban));
    return {
      summaries: summaries.map((item) => ({
        ...item,
        dueDate: effectiveDueDateMap.get(item.fseiban) ?? null
      }))
    };
  });
}
