import type { FastifyInstance } from 'fastify';

import { upsertProductionScheduleSeibanProcessingDueDate } from '../../../services/production-schedule/due-management-command.service.js';
import {
  productionScheduleDueManagementSeibanDueDateBodySchema,
  productionScheduleDueManagementSeibanProcessingParamsSchema,
  type KioskRouteDeps
} from './shared.js';

export async function registerProductionScheduleDueManagementProcessingDueDateRoute(
  app: FastifyInstance,
  deps: KioskRouteDeps
): Promise<void> {
  app.put(
    '/kiosk/production-schedule/due-management/seiban/:fseiban/processing/:processingType/due-date',
    { config: { rateLimit: false } },
    async (request) => {
      const { clientDevice } = await deps.requireClientDevice(request.headers['x-client-key']);
      const locationScopeContext = deps.resolveLocationScopeContext(clientDevice);
      const locationKey = locationScopeContext.deviceScopeKey;
      const params = productionScheduleDueManagementSeibanProcessingParamsSchema.parse(request.params);
      const body = productionScheduleDueManagementSeibanDueDateBodySchema.parse(request.body);

      return upsertProductionScheduleSeibanProcessingDueDate({
        locationKey,
        fseiban: params.fseiban,
        processingType: params.processingType,
        dueDateText: body.dueDate
      });
    }
  );
}
