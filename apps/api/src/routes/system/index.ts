import type { FastifyInstance } from 'fastify';
import { registerSystemHealthRoute } from './health.js';
import { registerMetricsRoute } from './metrics.js';

export async function registerSystemRoutes(app: FastifyInstance): Promise<void> {
  registerSystemHealthRoute(app);
  registerMetricsRoute(app);
}

