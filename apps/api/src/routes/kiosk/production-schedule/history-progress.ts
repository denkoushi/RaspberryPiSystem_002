import type { FastifyInstance } from 'fastify';

import { getProductionScheduleHistoryProgress } from '../../../services/production-schedule/production-schedule-search-state.service.js';
import type { KioskRouteDeps } from './shared.js';

export async function registerProductionScheduleHistoryProgressRoute(
  app: FastifyInstance,
  deps: KioskRouteDeps
): Promise<void> {
  app.get('/kiosk/production-schedule/history-progress', { config: { rateLimit: false } }, async (request) => {
    const { clientDevice } = await deps.requireClientDevice(request.headers['x-client-key']);
    const locationKey = deps.resolveLocationKey(clientDevice);
    return getProductionScheduleHistoryProgress(locationKey);
  });
}
