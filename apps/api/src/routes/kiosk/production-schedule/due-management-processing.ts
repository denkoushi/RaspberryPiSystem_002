import type { FastifyInstance } from 'fastify';

import { upsertProductionScheduleDueManagementPartProcessingType } from '../../../services/production-schedule/due-management-command.service.js';
import {
  productionScheduleDueManagementPartParamsSchema,
  productionScheduleProcessingBodySchema,
  type KioskRouteDeps
} from './shared.js';

export async function registerProductionScheduleDueManagementProcessingRoute(
  app: FastifyInstance,
  deps: KioskRouteDeps
): Promise<void> {
  app.put(
    '/kiosk/production-schedule/due-management/seiban/:fseiban/parts/:fhincd/processing',
    { config: { rateLimit: false } },
    async (request) => {
      const { clientDevice } = await deps.requireClientDevice(request.headers['x-client-key']);
      const locationKey = deps.resolveLocationKey(clientDevice);
      const params = productionScheduleDueManagementPartParamsSchema.parse(request.params);
      const body = productionScheduleProcessingBodySchema.parse(request.body);

      return upsertProductionScheduleDueManagementPartProcessingType({
        locationKey,
        fseiban: params.fseiban,
        fhincd: params.fhincd,
        processingType: body.processingType ?? ''
      });
    }
  );
}
