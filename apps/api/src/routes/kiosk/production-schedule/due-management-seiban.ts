import type { FastifyInstance } from 'fastify';

import { getDueManagementSeibanDetail } from '../../../services/production-schedule/due-management-query.service.js';
import { productionScheduleDueManagementSeibanParamsSchema, type KioskRouteDeps } from './shared.js';

export async function registerProductionScheduleDueManagementSeibanRoute(
  app: FastifyInstance,
  deps: KioskRouteDeps
): Promise<void> {
  app.get('/kiosk/production-schedule/due-management/seiban/:fseiban', { config: { rateLimit: false } }, async (request) => {
    const { clientDevice } = await deps.requireClientDevice(request.headers['x-client-key']);
    const locationKey = deps.resolveLocationKey(clientDevice);
    const params = productionScheduleDueManagementSeibanParamsSchema.parse(request.params);
    const detail = await getDueManagementSeibanDetail({
      locationKey,
      fseiban: params.fseiban
    });
    return { detail };
  });
}
