import { createHash } from 'crypto';
import type { FastifyInstance } from 'fastify';

import { requireDueManagementToken } from '../../../lib/auth.js';

import { ActualHoursImportOrchestratorService } from '../../../services/production-schedule/actual-hours/actual-hours-import-orchestrator.service.js';
import {
  resolveDueManagementStorageLocationKey,
  toDueManagementScopeFromContext
} from '../../../services/production-schedule/due-management-location-scope-adapter.service.js';
import { ProductionActualHoursAggregateService } from '../../../services/production-schedule/production-actual-hours-aggregate.service.js';
import {
  productionScheduleDueManagementActualHoursImportBodySchema,
  productionScheduleDueManagementActualHoursStatsQuerySchema,
  type KioskRouteDeps,
} from './shared.js';
import { TERMINAL_ROUTE_RATE_LIMIT } from '../../../lib/terminal-route-rate-limit.js';

export async function registerProductionScheduleDueManagementActualHoursRoute(
  app: FastifyInstance,
  deps: KioskRouteDeps
): Promise<void> {
  const importOrchestrator = new ActualHoursImportOrchestratorService();
  const aggregateService = new ProductionActualHoursAggregateService();

  app.post(
    '/kiosk/production-schedule/due-management/actual-hours/import',
    { config: { rateLimit: TERMINAL_ROUTE_RATE_LIMIT } },
    async (request) => {
      const { clientDevice } = await deps.requireClientDevice(request.headers['x-client-key']);
      await requireDueManagementToken(request.headers['x-due-management-token'], clientDevice.id);
      const locationScopeContext = deps.resolveLocationScopeContext(clientDevice);
      const dueManagementScope = toDueManagementScopeFromContext(locationScopeContext);
      const locationKey = resolveDueManagementStorageLocationKey(dueManagementScope);
      const body = productionScheduleDueManagementActualHoursImportBodySchema.parse(request.body ?? {});
      const buffer = Buffer.from(body.csvContent, 'utf8');
      const sourceFileKey = `manual:${locationKey}:${createHash('sha256').update(buffer).digest('hex')}`;
      const importResult = await importOrchestrator.importAndRebuild({
        buffer,
        sourceFileKey,
        locationKey,
      });
      return {
        success: true,
        sourceFileKey,
        ...importResult,
      };
    }
  );

  app.get(
    '/kiosk/production-schedule/due-management/actual-hours/stats',
    { config: { rateLimit: TERMINAL_ROUTE_RATE_LIMIT } },
    async (request) => {
      const { clientDevice } = await deps.requireClientDevice(request.headers['x-client-key']);
      const locationScopeContext = deps.resolveLocationScopeContext(clientDevice);
      const dueManagementScope = toDueManagementScopeFromContext(locationScopeContext);
      const locationKey = resolveDueManagementStorageLocationKey(dueManagementScope);
      const query = productionScheduleDueManagementActualHoursStatsQuerySchema.parse(request.query ?? {});
      const stats = await aggregateService.getStats({
        locationKey,
        limit: query.limit,
      });
      return stats;
    }
  );
}
