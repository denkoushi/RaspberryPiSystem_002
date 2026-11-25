import type { FastifyInstance } from 'fastify';

import { listSeibanProcessingDueDates } from '../../../services/production-schedule/due-date-resolution.service.js';
import { presentDueManagementSeibanDetail } from '../../../services/production-schedule/due-management-detail-presentation.service.js';
import {
  getDueManagementSeibanDetailWithScope,
  toDueManagementScopeFromContext
} from '../../../services/production-schedule/due-management-location-scope-adapter.service.js';
import { productionScheduleDueManagementSeibanParamsSchema, type KioskRouteDeps } from './shared.js';
import { TERMINAL_ROUTE_RATE_LIMIT } from '../../../lib/terminal-route-rate-limit.js';

export async function registerProductionScheduleDueManagementSeibanRoute(
  app: FastifyInstance,
  deps: KioskRouteDeps
): Promise<void> {
  app.get('/kiosk/production-schedule/due-management/seiban/:fseiban', { config: { rateLimit: TERMINAL_ROUTE_RATE_LIMIT } }, async (request) => {
    const { clientDevice } = await deps.requireClientDevice(request.headers['x-client-key']);
    const locationScopeContext = deps.resolveLocationScopeContext(clientDevice);
    const dueManagementScope = toDueManagementScopeFromContext(locationScopeContext);
    const params = productionScheduleDueManagementSeibanParamsSchema.parse(request.params);
    const detail = await getDueManagementSeibanDetailWithScope({
      locationScope: dueManagementScope,
      fseiban: params.fseiban
    });
    const processingDueDateMap = await listSeibanProcessingDueDates(params.fseiban);
    return {
      detail: presentDueManagementSeibanDetail({ detail, processingDueDateMap })
    };
  });
}
