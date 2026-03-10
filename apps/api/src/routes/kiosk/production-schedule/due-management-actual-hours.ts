import { createHash } from 'crypto';
import type { FastifyInstance } from 'fastify';

import { ProductionActualHoursAggregateService } from '../../../services/production-schedule/production-actual-hours-aggregate.service.js';
import { ProductionActualHoursImportService } from '../../../services/production-schedule/production-actual-hours-import.service.js';
import {
  productionScheduleDueManagementActualHoursImportBodySchema,
  productionScheduleDueManagementActualHoursStatsQuerySchema,
  type KioskRouteDeps,
} from './shared.js';

export async function registerProductionScheduleDueManagementActualHoursRoute(
  app: FastifyInstance,
  deps: KioskRouteDeps
): Promise<void> {
  const importService = new ProductionActualHoursImportService();
  const aggregateService = new ProductionActualHoursAggregateService();

  app.post(
    '/kiosk/production-schedule/due-management/actual-hours/import',
    { config: { rateLimit: false } },
    async (request) => {
      const { clientDevice } = await deps.requireClientDevice(request.headers['x-client-key']);
      const locationKey = deps.resolveLocationKey(clientDevice);
      const body = productionScheduleDueManagementActualHoursImportBodySchema.parse(request.body ?? {});
      const buffer = Buffer.from(body.csvContent, 'utf8');
      const sourceFileKey = `manual:${locationKey}:${createHash('sha256').update(buffer).digest('hex')}`;
      const importResult = await importService.importFromCsv({
        buffer,
        sourceFileKey,
      });
      const aggregateResult = await aggregateService.rebuild({ locationKey });
      return {
        success: true,
        sourceFileKey,
        ...importResult,
        ...aggregateResult,
      };
    }
  );

  app.get(
    '/kiosk/production-schedule/due-management/actual-hours/stats',
    { config: { rateLimit: false } },
    async (request) => {
      const { clientDevice } = await deps.requireClientDevice(request.headers['x-client-key']);
      const locationKey = deps.resolveLocationKey(clientDevice);
      const query = productionScheduleDueManagementActualHoursStatsQuerySchema.parse(request.query ?? {});
      const stats = await aggregateService.getStats({
        locationKey,
        limit: query.limit,
      });
      return stats;
    }
  );
}
