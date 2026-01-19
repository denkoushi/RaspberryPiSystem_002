import type { FastifyInstance } from 'fastify';
import { registerSystemHealthRoute } from './health.js';
import { registerMetricsRoute } from './metrics.js';
import { registerDebugRoutes } from './debug.js';
import { registerSystemInfoRoute } from './system-info.js';
import { registerNetworkModeRoute } from './network-mode.js';
import { registerDeployStatusRoute } from './deploy-status.js';

export async function registerSystemRoutes(app: FastifyInstance): Promise<void> {
  registerSystemHealthRoute(app);
  registerMetricsRoute(app);
  registerDebugRoutes(app);
  registerSystemInfoRoute(app);
  registerNetworkModeRoute(app);
  registerDeployStatusRoute(app);
}

