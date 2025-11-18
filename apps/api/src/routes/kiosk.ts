import type { FastifyInstance } from 'fastify';

export async function registerKioskRoutes(app: FastifyInstance): Promise<void> {
  app.get('/kiosk/config', async () => ({
    theme: 'factory-dark',
    greeting: 'タグを順番にかざしてください',
    idleTimeoutMs: 30000
  }));
}
