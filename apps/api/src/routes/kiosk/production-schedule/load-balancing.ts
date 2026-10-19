import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import { ApiError } from '../../../lib/errors.js';
import { upsertLoadBalancingCapacityBaseItem } from '../../../services/production-schedule/load-balancing/load-balancing-settings.service.js';
import {
  getProductionScheduleLoadBalancingWorkspace,
  getProductionScheduleLoadBalancingWorkspaceDay
} from '../../../services/production-schedule/load-balancing/load-balancing-workspace.service.js';
import { resolveProductionScheduleAssignmentLocationKey } from './resolve-assignment-location-key.js';
import { toLegacyLocationKeyFromDeviceScope, type KioskRouteDeps } from './shared.js';

const workspaceQuerySchema = z.object({
  fromMonth: z.string().regex(/^\d{4}-\d{2}$/),
  toMonth: z.string().regex(/^\d{4}-\d{2}$/),
  targetDeviceScopeKey: z.string().min(1).max(200).optional()
});

const workspaceDayQuerySchema = z.object({
  month: z.string().regex(/^\d{4}-\d{2}$/),
  resourceCd: z.string().trim().min(1).max(20),
  fromMonth: z.string().regex(/^\d{4}-\d{2}$/).optional(),
  toMonth: z.string().regex(/^\d{4}-\d{2}$/).optional(),
  targetDeviceScopeKey: z.string().min(1).max(200).optional()
});

const capacityBaseBodySchema = z.object({
  resourceCd: z.string().trim().min(1).max(20),
  baseAvailableMinutes: z.number().int().min(0).max(1_000_000),
  targetDeviceScopeKey: z.string().min(1).max(200).optional()
});

const WORKSPACE_RECOVERABLE_MESSAGES = ['以前である必要があります', '最大 ', 'YYYY-MM 形式'];

function toWorkspaceApiError(error: unknown): unknown {
  if (error instanceof ApiError) return error;
  if (error instanceof Error && WORKSPACE_RECOVERABLE_MESSAGES.some((snippet) => error.message.includes(snippet))) {
    return new ApiError(400, error.message);
  }
  return error;
}


export async function registerProductionScheduleLoadBalancingRoutes(
  app: FastifyInstance,
  deps: KioskRouteDeps
): Promise<void> {
  app.get('/kiosk/production-schedule/load-balancing/workspace', { config: { rateLimit: false } }, async (request) => {
    const { clientDevice } = await deps.requireClientDevice(request.headers['x-client-key']);
    const locationScopeContext = deps.resolveLocationScopeContext(clientDevice);
    const actorDeviceScopeKey = locationScopeContext.deviceScopeKey;
    const query = workspaceQuerySchema.parse(request.query);

    const resolvedSiteKey = await resolveProductionScheduleAssignmentLocationKey({
      actorDeviceScopeKey: toLegacyLocationKeyFromDeviceScope(actorDeviceScopeKey),
      actorCanProxyOtherDevices: locationScopeContext.canProxyOtherDevices,
      targetDeviceScopeKey: query.targetDeviceScopeKey
    });

    try {
      return await getProductionScheduleLoadBalancingWorkspace({
        siteKeyInput: resolvedSiteKey,
        deviceScopeKey: query.targetDeviceScopeKey?.trim() || actorDeviceScopeKey,
        fromMonth: query.fromMonth,
        toMonth: query.toMonth
      });
    } catch (error) {
      throw toWorkspaceApiError(error);
    }
  });

  app.get('/kiosk/production-schedule/load-balancing/workspace/day', { config: { rateLimit: false } }, async (request) => {
    const { clientDevice } = await deps.requireClientDevice(request.headers['x-client-key']);
    const locationScopeContext = deps.resolveLocationScopeContext(clientDevice);
    const actorDeviceScopeKey = locationScopeContext.deviceScopeKey;
    const query = workspaceDayQuerySchema.parse(request.query);

    const resolvedSiteKey = await resolveProductionScheduleAssignmentLocationKey({
      actorDeviceScopeKey: toLegacyLocationKeyFromDeviceScope(actorDeviceScopeKey),
      actorCanProxyOtherDevices: locationScopeContext.canProxyOtherDevices,
      targetDeviceScopeKey: query.targetDeviceScopeKey
    });

    try {
      return await getProductionScheduleLoadBalancingWorkspaceDay({
        siteKeyInput: resolvedSiteKey,
        deviceScopeKey: query.targetDeviceScopeKey?.trim() || actorDeviceScopeKey,
        month: query.month,
        resourceCd: query.resourceCd,
        fromMonth: query.fromMonth,
        toMonth: query.toMonth
      });
    } catch (error) {
      throw toWorkspaceApiError(error);
    }
  });

  app.put('/kiosk/production-schedule/load-balancing/capacity-base', { config: { rateLimit: false } }, async (request) => {
    const { clientDevice } = await deps.requireClientDevice(request.headers['x-client-key']);
    const locationScopeContext = deps.resolveLocationScopeContext(clientDevice);
    const actorDeviceScopeKey = locationScopeContext.deviceScopeKey;
    const body = capacityBaseBodySchema.parse(request.body ?? {});

    const resolvedSiteKey = await resolveProductionScheduleAssignmentLocationKey({
      actorDeviceScopeKey: toLegacyLocationKeyFromDeviceScope(actorDeviceScopeKey),
      actorCanProxyOtherDevices: locationScopeContext.canProxyOtherDevices,
      targetDeviceScopeKey: body.targetDeviceScopeKey
    });

    return upsertLoadBalancingCapacityBaseItem({
      siteKeyInput: resolvedSiteKey,
      resourceCd: body.resourceCd,
      baseAvailableMinutes: body.baseAvailableMinutes
    });
  });
}
