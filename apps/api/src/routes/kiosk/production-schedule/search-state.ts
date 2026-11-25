import type { FastifyInstance } from 'fastify';

import {
  getProductionScheduleSearchState,
  updateProductionScheduleSearchState
} from '../../../services/production-schedule/production-schedule-search-state.service.js';
import {
  productionScheduleSearchStateBodySchema,
  toLegacyLocationKeyFromDeviceScope,
  type KioskRouteDeps
} from './shared.js';
import { TERMINAL_ROUTE_RATE_LIMIT } from '../../../lib/terminal-route-rate-limit.js';

export async function registerProductionScheduleSearchStateRoute(
  app: FastifyInstance,
  deps: KioskRouteDeps
): Promise<void> {
  app.get('/kiosk/production-schedule/search-state', { config: { rateLimit: TERMINAL_ROUTE_RATE_LIMIT } }, async (request, reply) => {
    const { clientDevice } = await deps.requireClientDevice(request.headers['x-client-key']);
    const locationScopeContext = deps.resolveLocationScopeContext(clientDevice);
    const deviceScopeKey = locationScopeContext.deviceScopeKey;
    const result = await getProductionScheduleSearchState(deviceScopeKey);
    reply.header('ETag', result.etag);
    return {
      state: result.state,
      updatedAt: result.updatedAt,
      locationScope: {
        deviceScopeKey: locationScopeContext.deviceScopeKey,
        siteKey: locationScopeContext.siteKey
      }
    };
  });

  app.put('/kiosk/production-schedule/search-state', { config: { rateLimit: TERMINAL_ROUTE_RATE_LIMIT } }, async (request, reply) => {
    const { clientDevice } = await deps.requireClientDevice(request.headers['x-client-key']);
    const locationScopeContext = deps.resolveLocationScopeContext(clientDevice);
    const deviceScopeKey = locationScopeContext.deviceScopeKey;
    const body = productionScheduleSearchStateBodySchema.parse(request.body);
    const result = await updateProductionScheduleSearchState({
      locationKey: toLegacyLocationKeyFromDeviceScope(deviceScopeKey),
      ifMatchHeader: request.headers['if-match'],
      incomingHistory: body.state.history ?? []
    });
    reply.header('ETag', result.etag);
    return { state: result.state, updatedAt: result.updatedAt };
  });
}
