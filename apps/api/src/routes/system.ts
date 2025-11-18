import type { FastifyInstance } from 'fastify';

export async function registerSystemRoutes(app: FastifyInstance): Promise<void> {
  app.get('/health', async () => ({ status: 'ok' }));
}
