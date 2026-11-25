import type { FastifyInstance } from 'fastify';

import {
  getProductionScheduleSearchHistory,
  updateProductionScheduleSearchHistory
} from '../../../services/production-schedule/production-schedule-search-state.service.js';
import {
  productionScheduleSearchHistoryBodySchema,
  toLegacyLocationKeyFromDeviceScope,
  type KioskRouteDeps
} from './shared.js';
import { TERMINAL_ROUTE_RATE_LIMIT } from '../../../lib/terminal-route-rate-limit.js';

export async function registerProductionScheduleSearchHistoryRoute(
  app: FastifyInstance,
  deps: KioskRouteDeps
): Promise<void> {
  app.get('/kiosk/production-schedule/search-history', { config: { rateLimit: TERMINAL_ROUTE_RATE_LIMIT } }, async (request) => {
    const { clientDevice } = await deps.requireClientDevice(request.headers['x-client-key']);
    const locationScopeContext = deps.resolveLocationScopeContext(clientDevice);
    const deviceScopeKey = locationScopeContext.deviceScopeKey;
    return getProductionScheduleSearchHistory(deviceScopeKey);
  });

  app.put('/kiosk/production-schedule/search-history', { config: { rateLimit: TERMINAL_ROUTE_RATE_LIMIT } }, async (request) => {
    const { clientDevice } = await deps.requireClientDevice(request.headers['x-client-key']);
    const locationScopeContext = deps.resolveLocationScopeContext(clientDevice);
    const deviceScopeKey = locationScopeContext.deviceScopeKey;
    const body = productionScheduleSearchHistoryBodySchema.parse(request.body);
    return updateProductionScheduleSearchHistory({
      locationKey: toLegacyLocationKeyFromDeviceScope(deviceScopeKey),
      history: body.history
    });
  });
}
