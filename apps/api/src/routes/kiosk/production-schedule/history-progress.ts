import type { FastifyInstance } from 'fastify';

import { getProductionScheduleHistoryProgress } from '../../../services/production-schedule/production-schedule-search-state.service.js';
import { toLegacyLocationKeyFromDeviceScope, type KioskRouteDeps } from './shared.js';
import { TERMINAL_ROUTE_RATE_LIMIT } from '../../../lib/terminal-route-rate-limit.js';

export async function registerProductionScheduleHistoryProgressRoute(
  app: FastifyInstance,
  deps: KioskRouteDeps
): Promise<void> {
  app.get('/kiosk/production-schedule/history-progress', { config: { rateLimit: TERMINAL_ROUTE_RATE_LIMIT } }, async (request) => {
    const { clientDevice } = await deps.requireClientDevice(request.headers['x-client-key']);
    const locationScopeContext = deps.resolveLocationScopeContext(clientDevice);
    const deviceScopeKey = locationScopeContext.deviceScopeKey;
    return getProductionScheduleHistoryProgress(toLegacyLocationKeyFromDeviceScope(deviceScopeKey));
  });
}
