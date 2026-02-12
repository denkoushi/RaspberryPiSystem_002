import type { FastifyInstance } from 'fastify';
import { registerProductionScheduleRoutes } from './kiosk/production-schedule/index.js';
import { registerKioskEmployeesRoute } from './kiosk/employees.js';
import { registerKioskConfigRoute } from './kiosk/config.js';
import { registerKioskCallTargetsRoute } from './kiosk/call-targets.js';
import { registerKioskSupportRoute } from './kiosk/support.js';
import { registerKioskPowerRoute } from './kiosk/power.js';
import {
  checkPowerRateLimit,
  checkRateLimit,
  getWebRTCCallExcludeClientIds,
  normalizeClientKey,
  requireClientDevice,
  resolveLocationKey
} from './kiosk/shared.js';

const POWER_ACTIONS_DIR = process.env.POWER_ACTIONS_DIR ?? '/app/power-actions';

export async function registerKioskRoutes(app: FastifyInstance): Promise<void> {
  await registerKioskEmployeesRoute(app, {
    requireClientDevice
  });

  await registerProductionScheduleRoutes(app, {
    requireClientDevice,
    resolveLocationKey
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
    checkRateLimit
  });

  await registerKioskPowerRoute(app, {
    requireClientDevice,
    checkPowerRateLimit,
    powerActionsDir: POWER_ACTIONS_DIR
  });
}
