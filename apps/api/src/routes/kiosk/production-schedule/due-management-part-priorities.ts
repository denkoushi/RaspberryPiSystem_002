import type { FastifyInstance } from 'fastify';

import { upsertProductionSchedulePartPriorities } from '../../../services/production-schedule/due-management-command.service.js';
import {
  productionScheduleDueManagementPartPrioritiesBodySchema,
  productionScheduleDueManagementSeibanParamsSchema,
  type KioskRouteDeps
} from './shared.js';

export async function registerProductionScheduleDueManagementPartPrioritiesRoute(
  app: FastifyInstance,
  deps: KioskRouteDeps
): Promise<void> {
  app.put(
    '/kiosk/production-schedule/due-management/seiban/:fseiban/part-priorities',
    { config: { rateLimit: false } },
    async (request) => {
      const { clientDevice } = await deps.requireClientDevice(request.headers['x-client-key']);
      const locationKey = deps.resolveLocationKey(clientDevice);
      const params = productionScheduleDueManagementSeibanParamsSchema.parse(request.params);
      const body = productionScheduleDueManagementPartPrioritiesBodySchema.parse(request.body);
      return upsertProductionSchedulePartPriorities({
        locationKey,
        fseiban: params.fseiban,
        orderedFhincds: body.orderedFhincds
      });
    }
  );
}
