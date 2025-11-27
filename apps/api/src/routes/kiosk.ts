import type { FastifyInstance } from 'fastify';
import { prisma } from '../lib/prisma.js';

export async function registerKioskRoutes(app: FastifyInstance): Promise<void> {
  app.get('/kiosk/config', { config: { rateLimit: false } }, async (request) => {
    // クライアントキーからクライアント端末を特定
    const clientKey = request.headers['x-client-key'] as string | undefined;
    app.log.info({ clientKey, headers: request.headers }, 'Kiosk config request');
    let defaultMode: 'PHOTO' | 'TAG' = 'TAG'; // デフォルトはTAG

    if (clientKey) {
      const client = await prisma.clientDevice.findUnique({
        where: { apiKey: clientKey },
        select: { defaultMode: true }
      });
      app.log.info({ client, clientKey }, 'Client device lookup result');
      if (client?.defaultMode) {
        defaultMode = client.defaultMode as 'PHOTO' | 'TAG';
      }
    }

    app.log.info({ defaultMode }, 'Returning kiosk config');
    return {
      theme: 'factory-dark',
      greeting: 'タグを順番にかざしてください',
      idleTimeoutMs: 30000,
      defaultMode
    };
  });
}
