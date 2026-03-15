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
    const locationScopeContext = deps.resolveLocationScopeContext(clientDevice);
    const deviceScopeKey = locationScopeContext.deviceScopeKey;
    return getProductionScheduleSearchHistory(deviceScopeKey);
  });

  app.put('/kiosk/production-schedule/search-history', { config: { rateLimit: false } }, async (request) => {
    const { clientDevice } = await deps.requireClientDevice(request.headers['x-client-key']);
    const locationScopeContext = deps.resolveLocationScopeContext(clientDevice);
    const deviceScopeKey = locationScopeContext.deviceScopeKey;
    const body = productionScheduleSearchHistoryBodySchema.parse(request.body);
    return updateProductionScheduleSearchHistory({
      locationKey: deviceScopeKey,
      history: body.history
    });
  });
}
