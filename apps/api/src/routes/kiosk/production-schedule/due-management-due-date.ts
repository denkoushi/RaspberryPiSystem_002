import type { FastifyInstance } from 'fastify';

import { upsertProductionScheduleSeibanDueDate } from '../../../services/production-schedule/due-management-command.service.js';
import {
  productionScheduleDueManagementSeibanDueDateBodySchema,
  productionScheduleDueManagementSeibanParamsSchema,
  type KioskRouteDeps
} from './shared.js';

export async function registerProductionScheduleDueManagementDueDateRoute(
  app: FastifyInstance,
  deps: KioskRouteDeps
): Promise<void> {
  app.put(
    '/kiosk/production-schedule/due-management/seiban/:fseiban/due-date',
    { config: { rateLimit: false } },
    async (request) => {
      const { clientDevice } = await deps.requireClientDevice(request.headers['x-client-key']);
      const locationKey = deps.resolveLocationKey(clientDevice);
      const params = productionScheduleDueManagementSeibanParamsSchema.parse(request.params);
      const body = productionScheduleDueManagementSeibanDueDateBodySchema.parse(request.body);

      return upsertProductionScheduleSeibanDueDate({
        locationKey,
        fseiban: params.fseiban,
        dueDateText: body.dueDate
      });
    }
  );
}
