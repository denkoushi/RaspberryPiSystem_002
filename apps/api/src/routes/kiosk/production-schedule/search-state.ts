import type { FastifyInstance } from 'fastify';

import {
  getProductionScheduleSearchState,
  updateProductionScheduleSearchState
} from '../../../services/production-schedule/production-schedule-search-state.service.js';
import { productionScheduleSearchStateBodySchema, type KioskRouteDeps } from './shared.js';

export async function registerProductionScheduleSearchStateRoute(
  app: FastifyInstance,
  deps: KioskRouteDeps
): Promise<void> {
  app.get('/kiosk/production-schedule/search-state', { config: { rateLimit: false } }, async (request, reply) => {
    const { clientDevice } = await deps.requireClientDevice(request.headers['x-client-key']);
    const locationScopeContext = deps.resolveLocationScopeContext(clientDevice);
    const locationKey = locationScopeContext.deviceScopeKey;
    const result = await getProductionScheduleSearchState(locationKey);
    reply.header('ETag', result.etag);
    return { state: result.state, updatedAt: result.updatedAt };
  });

  app.put('/kiosk/production-schedule/search-state', { config: { rateLimit: false } }, async (request, reply) => {
    const { clientDevice } = await deps.requireClientDevice(request.headers['x-client-key']);
    const locationScopeContext = deps.resolveLocationScopeContext(clientDevice);
    const locationKey = locationScopeContext.deviceScopeKey;
    const body = productionScheduleSearchStateBodySchema.parse(request.body);
    const result = await updateProductionScheduleSearchState({
      locationKey,
      ifMatchHeader: request.headers['if-match'],
      incomingHistory: body.state.history ?? []
    });
    reply.header('ETag', result.etag);
    return { state: result.state, updatedAt: result.updatedAt };
  });
}
