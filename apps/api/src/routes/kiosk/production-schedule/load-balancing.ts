import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import { ApiError } from '../../../lib/errors.js';
import { getProductionScheduleLoadBalancingOverview } from '../../../services/production-schedule/load-balancing/load-balancing-overview.service.js';
import { parseYearMonthRangeUtc } from '../../../services/production-schedule/load-balancing/monthly-load-query.service.js';
import { suggestProductionScheduleLoadBalancing } from '../../../services/production-schedule/load-balancing/reallocation-suggestion.service.js';
import { resolveProductionScheduleAssignmentLocationKey } from './resolve-assignment-location-key.js';
import { toLegacyLocationKeyFromDeviceScope, type KioskRouteDeps } from './shared.js';

const overviewQuerySchema = z.object({
  month: z.string().regex(/^\d{4}-\d{2}$/),
  targetDeviceScopeKey: z.string().min(1).max(200).optional()
});

const suggestionsBodySchema = z.object({
  month: z.string().regex(/^\d{4}-\d{2}$/),
  targetDeviceScopeKey: z.string().min(1).max(200).optional(),
  maxSuggestions: z.coerce.number().int().min(1).max(200).optional(),
  overResourceCds: z.array(z.string().min(1).max(20)).max(100).optional()
});

function assertValidYearMonth(month: string): void {
  try {
    parseYearMonthRangeUtc(month);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'month が不正です';
    throw new ApiError(400, message);
  }
}

export async function registerProductionScheduleLoadBalancingRoutes(
  app: FastifyInstance,
  deps: KioskRouteDeps
): Promise<void> {
  app.get('/kiosk/production-schedule/load-balancing/overview', { config: { rateLimit: false } }, async (request) => {
    const { clientDevice } = await deps.requireClientDevice(request.headers['x-client-key']);
    const locationScopeContext = deps.resolveLocationScopeContext(clientDevice);
    const actorDeviceScopeKey = locationScopeContext.deviceScopeKey;
    const query = overviewQuerySchema.parse(request.query);

    const resolvedSiteKey = await resolveProductionScheduleAssignmentLocationKey({
      actorDeviceScopeKey: toLegacyLocationKeyFromDeviceScope(actorDeviceScopeKey),
      targetDeviceScopeKey: query.targetDeviceScopeKey
    });

    assertValidYearMonth(query.month);

    return getProductionScheduleLoadBalancingOverview({
      siteKey: resolvedSiteKey,
      deviceScopeKey: query.targetDeviceScopeKey?.trim() || actorDeviceScopeKey,
      yearMonth: query.month
    });
  });

  app.post('/kiosk/production-schedule/load-balancing/suggestions', { config: { rateLimit: false } }, async (request) => {
    const { clientDevice } = await deps.requireClientDevice(request.headers['x-client-key']);
    const locationScopeContext = deps.resolveLocationScopeContext(clientDevice);
    const actorDeviceScopeKey = locationScopeContext.deviceScopeKey;
    const body = suggestionsBodySchema.parse(request.body ?? {});

    const resolvedSiteKey = await resolveProductionScheduleAssignmentLocationKey({
      actorDeviceScopeKey: toLegacyLocationKeyFromDeviceScope(actorDeviceScopeKey),
      targetDeviceScopeKey: body.targetDeviceScopeKey
    });

    assertValidYearMonth(body.month);

    return suggestProductionScheduleLoadBalancing({
      siteKey: resolvedSiteKey,
      deviceScopeKey: body.targetDeviceScopeKey?.trim() || actorDeviceScopeKey,
      yearMonth: body.month,
      maxSuggestions: body.maxSuggestions ?? 25,
      overResourceCds: body.overResourceCds
    });
  });
}
