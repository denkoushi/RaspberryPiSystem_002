import type { FastifyInstance } from 'fastify';
import { prisma } from '../lib/prisma.js';

export async function registerKioskRoutes(app: FastifyInstance): Promise<void> {
  app.get('/kiosk/config', { config: { rateLimit: false } }, async (request) => {
    // クライアントキーからクライアント端末を特定
    const rawClientKey = request.headers['x-client-key'];
    // ヘッダーが文字列配列の場合や、JSON文字列化されている場合に対応
    let clientKey: string | undefined;
    if (typeof rawClientKey === 'string') {
      // JSON文字列化されている場合（"client-demo-key"）をパース
      try {
        const parsed = JSON.parse(rawClientKey);
        clientKey = typeof parsed === 'string' ? parsed : rawClientKey;
      } catch {
        clientKey = rawClientKey;
      }
    } else if (Array.isArray(rawClientKey) && rawClientKey.length > 0) {
      clientKey = rawClientKey[0];
    }
    
    app.log.info({ clientKey, rawClientKey, headers: request.headers }, 'Kiosk config request');
    let defaultMode: 'PHOTO' | 'TAG' = 'TAG'; // デフォルトはTAG

    if (clientKey) {
      const client = await prisma.clientDevice.findUnique({
        where: { apiKey: clientKey }
      });
      app.log.info({ client, clientKey, found: !!client, defaultMode: client?.defaultMode }, 'Client device lookup result');
      if (client?.defaultMode) {
        defaultMode = client.defaultMode as 'PHOTO' | 'TAG';
      }
    }

    app.log.info({ defaultMode, clientKey }, 'Returning kiosk config');
    return {
      theme: 'factory-dark',
      greeting: 'タグを順番にかざしてください',
      idleTimeoutMs: 30000,
      defaultMode
    };
  });
}
