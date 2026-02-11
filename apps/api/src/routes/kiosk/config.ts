import type { FastifyInstance } from 'fastify';

import { prisma } from '../../lib/prisma.js';

type ConfigRouteDeps = {
  normalizeClientKey: (rawKey: unknown) => string | undefined;
};

export async function registerKioskConfigRoute(
  app: FastifyInstance,
  deps: ConfigRouteDeps
): Promise<void> {
  app.get('/kiosk/config', { config: { rateLimit: false } }, async (request) => {
    // クライアントキーからクライアント端末を特定
    const rawClientKey = request.headers['x-client-key'];
    const clientKey = deps.normalizeClientKey(rawClientKey);

    // 機密情報保護: x-client-keyをログから除外
    const sanitizedHeaders = { ...request.headers };
    if ('x-client-key' in sanitizedHeaders) {
      sanitizedHeaders['x-client-key'] = '[REDACTED]';
    }
    app.log.info(
      {
        clientKey: clientKey ? '[REDACTED]' : undefined,
        rawClientKey: '[REDACTED]',
        headers: sanitizedHeaders
      },
      'Kiosk config request'
    );
    let defaultMode: 'PHOTO' | 'TAG' = 'TAG'; // デフォルトはTAG
    let clientStatus: {
      temperature: number | null;
      cpuUsage: number;
      lastSeen: Date;
    } | null = null;

    if (clientKey) {
      const client = await prisma.clientDevice.findUnique({
        where: { apiKey: clientKey }
      });
      // 機密情報保護: clientKeyとclient.apiKeyをログから除外
      const sanitizedClient = client ? { ...client, apiKey: '[REDACTED]' } : null;
      app.log.info(
        {
          client: sanitizedClient,
          clientKey: '[REDACTED]',
          found: !!client,
          defaultMode: client?.defaultMode
        },
        'Client device lookup result'
      );
      if (client) {
        await prisma.clientDevice.update({
          where: { id: client.id },
          data: { lastSeenAt: new Date() }
        });
      }
      if (client?.defaultMode) {
        defaultMode = client.defaultMode as 'PHOTO' | 'TAG';
      }

      // statusClientId で ClientStatus を取得（自端末の温度・CPU負荷を返す）
      const statusClientId = (client as { statusClientId?: string | null } | null)?.statusClientId;
      if (statusClientId) {
        const status = await prisma.clientStatus.findUnique({
          where: { clientId: statusClientId }
        });
        if (status) {
          clientStatus = {
            temperature: status.temperature,
            cpuUsage: status.cpuUsage,
            lastSeen: status.lastSeen
          };
        }
      }
    }

    // 機密情報保護: clientKeyをログから除外
    app.log.info(
      {
        defaultMode,
        clientKey: '[REDACTED]',
        hasClientStatus: !!clientStatus
      },
      'Returning kiosk config'
    );
    return {
      theme: 'factory-dark',
      greeting: 'タグを順番にかざしてください',
      idleTimeoutMs: 30000,
      defaultMode,
      clientStatus
    };
  });
}
