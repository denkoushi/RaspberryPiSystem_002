import type { FastifyInstance } from 'fastify';

import { listEarliestEffectiveDueDateBySeiban } from '../../../services/production-schedule/due-date-resolution.service.js';
import {
  listDueManagementSummariesWithScope,
  toDueManagementScopeFromContext
} from '../../../services/production-schedule/due-management-location-scope-adapter.service.js';
import {
  hasDueManagementResourceFilter,
  listDueManagementFilteredFseibans
} from '../../../services/production-schedule/due-management-resource-filter.service.js';
import {
  productionScheduleDueManagementFilterQuerySchema,
  type KioskRouteDeps
} from './shared.js';

export async function registerProductionScheduleDueManagementSummaryRoute(
  app: FastifyInstance,
  deps: KioskRouteDeps
): Promise<void> {
  app.get('/kiosk/production-schedule/due-management/summary', { config: { rateLimit: false } }, async (request) => {
    const { clientDevice } = await deps.requireClientDevice(request.headers['x-client-key']);
    const locationScopeContext = deps.resolveLocationScopeContext(clientDevice);
    const dueManagementScope = toDueManagementScopeFromContext(locationScopeContext);
    const query = productionScheduleDueManagementFilterQuerySchema.parse(request.query);
    const summaries = await listDueManagementSummariesWithScope(dueManagementScope);
    let resolvedSummaries = summaries;
    if (hasDueManagementResourceFilter(query)) {
      const filteredFseibans = await listDueManagementFilteredFseibans({
        locationScope: dueManagementScope,
        filter: query
      });
      const allowedFseibans = new Set(filteredFseibans);
      resolvedSummaries = summaries.filter((item) => allowedFseibans.has(item.fseiban));
    }
    const effectiveDueDateMap = await listEarliestEffectiveDueDateBySeiban(
      resolvedSummaries.map((item) => item.fseiban)
    );
    return {
      summaries: resolvedSummaries.map((item) => ({
        ...item,
        dueDate: effectiveDueDateMap.get(item.fseiban) ?? null
      }))
    };
  });
}
