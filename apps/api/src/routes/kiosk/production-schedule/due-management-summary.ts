import type { FastifyInstance } from 'fastify';

import { listEarliestEffectiveDueDateBySeiban } from '../../../services/production-schedule/due-date-resolution.service.js';
import { listDueManagementSummariesWithScope } from '../../../services/production-schedule/due-management-location-scope-adapter.service.js';
import type { KioskRouteDeps } from './shared.js';

export async function registerProductionScheduleDueManagementSummaryRoute(
  app: FastifyInstance,
  deps: KioskRouteDeps
): Promise<void> {
  app.get('/kiosk/production-schedule/due-management/summary', { config: { rateLimit: false } }, async (request) => {
    const { clientDevice } = await deps.requireClientDevice(request.headers['x-client-key']);
    const locationScopeContext = deps.resolveLocationScopeContext(clientDevice);
    const summaries = await listDueManagementSummariesWithScope(locationScopeContext);
    const effectiveDueDateMap = await listEarliestEffectiveDueDateBySeiban(summaries.map((item) => item.fseiban));
    return {
      summaries: summaries.map((item) => ({
        ...item,
        dueDate: effectiveDueDateMap.get(item.fseiban) ?? null
      }))
    };
  });
}
