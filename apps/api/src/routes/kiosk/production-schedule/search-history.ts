import type { FastifyInstance } from 'fastify';

import {
  getProductionScheduleSearchHistory,
  updateProductionScheduleSearchHistory
} from '../../../services/production-schedule/production-schedule-search-state.service.js';
import { productionScheduleSearchHistoryBodySchema, type KioskRouteDeps } from './shared.js';

export async function registerProductionScheduleSearchHistoryRoute(
  app: FastifyInstance,
  deps: KioskRouteDeps
): Promise<void> {
  app.get('/kiosk/production-schedule/search-history', { config: { rateLimit: false } }, async (request) => {
    const { clientDevice } = await deps.requireClientDevice(request.headers['x-client-key']);
    const locationKey = deps.resolveLocationKey(clientDevice);
    return getProductionScheduleSearchHistory(locationKey);
  });

  app.put('/kiosk/production-schedule/search-history', { config: { rateLimit: false } }, async (request) => {
    const { clientDevice } = await deps.requireClientDevice(request.headers['x-client-key']);
    const locationKey = deps.resolveLocationKey(clientDevice);
    const body = productionScheduleSearchHistoryBodySchema.parse(request.body);
    return updateProductionScheduleSearchHistory({
      locationKey,
      history: body.history
    });
  });
}
