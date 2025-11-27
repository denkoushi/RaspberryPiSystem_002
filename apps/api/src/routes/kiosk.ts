import type { FastifyInstance } from 'fastify';
import { prisma } from '../lib/prisma.js';

export async function registerKioskRoutes(app: FastifyInstance): Promise<void> {
  app.get('/kiosk/config', { config: { rateLimit: false } }, async (request) => {
    // クライアントキーからクライアント端末を特定
    const clientKey = request.headers['x-client-key'] as string | undefined;
    let defaultMode: 'PHOTO' | 'TAG' = 'TAG'; // デフォルトはTAG

    if (clientKey) {
      const client = await prisma.clientDevice.findUnique({
        where: { apiKey: clientKey },
        select: { defaultMode: true }
      });
      if (client?.defaultMode) {
        defaultMode = client.defaultMode as 'PHOTO' | 'TAG';
      }
    }

    return {
      theme: 'factory-dark',
      greeting: 'タグを順番にかざしてください',
      idleTimeoutMs: 30000,
      defaultMode
    };
  });
}
