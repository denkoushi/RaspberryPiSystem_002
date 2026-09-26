import type { FastifyInstance } from 'fastify';

import { registerClientCoreRoutes } from './core.js';
import { registerClientAlertRoutes } from './alerts.js';
import { registerSiteRoutes } from './sites.js';

export async function registerClientRoutes(app: FastifyInstance): Promise<void> {
  await registerClientCoreRoutes(app);
  await registerClientAlertRoutes(app);
  await registerSiteRoutes(app);
}
