import type { FastifyInstance } from 'fastify';
import { registerProductionScheduleRoutes } from './kiosk/production-schedule/index.js';
import { registerKioskEmployeesRoute } from './kiosk/employees.js';
import { registerKioskConfigRoute } from './kiosk/config.js';
import { registerKioskCallTargetsRoute } from './kiosk/call-targets.js';
import { registerKioskSupportRoute } from './kiosk/support.js';
import { registerKioskPowerRoute } from './kiosk/power.js';
import { registerKioskSignagePreviewRoutes } from './kiosk/signage-preview.js';
import { registerPurchaseOrderLookupRoute } from './kiosk/purchase-order-lookup.js';
import {
  checkPowerRateLimit,
  checkRateLimit,
  getWebRTCCallExcludeClientIds,
  normalizeClientKey,
  requireClientDevice,
  resolveLocationScopeContext,
  resolveTargetLocation
} from './kiosk/shared.js';

const POWER_ACTIONS_DIR = process.env.POWER_ACTIONS_DIR ?? '/app/power-actions';

export async function registerKioskRoutes(app: FastifyInstance): Promise<void> {
  await registerKioskEmployeesRoute(app, {
    requireClientDevice
  });

  await registerProductionScheduleRoutes(app, {
    requireClientDevice,
    resolveLocationScopeContext,
    resolveTargetLocation
  });

  await registerKioskConfigRoute(app, {
    normalizeClientKey
  });

  await registerKioskCallTargetsRoute(app, {
    normalizeClientKey,
    getWebRTCCallExcludeClientIds
  });

  await registerKioskSupportRoute(app, {
    normalizeClientKey,
    checkRateLimit,
    resolveLocationScopeContext
  });

  await registerKioskPowerRoute(app, {
    requireClientDevice,
    checkPowerRateLimit,
    powerActionsDir: POWER_ACTIONS_DIR
  });

  await registerKioskSignagePreviewRoutes(app, {
    requireClientDevice
  });

  await registerPurchaseOrderLookupRoute(app, {
    requireClientDevice
  });
}
