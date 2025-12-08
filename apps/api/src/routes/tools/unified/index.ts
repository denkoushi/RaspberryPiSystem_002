import type { FastifyInstance } from 'fastify';
import { registerUnifiedListRoute } from './list.js';

export async function registerUnifiedRoutes(app: FastifyInstance): Promise<void> {
  registerUnifiedListRoute(app);
}
