import type { FastifyInstance } from 'fastify';

import { getKioskHeaderTabOrderSettings } from '../../services/kiosk/kiosk-header-tab-order.service.js';
import { resolveKioskConfigClientState } from '../../services/kiosk/kiosk-config.service.js';

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

    const { client, defaultMode, clientStatus } = await resolveKioskConfigClientState(clientKey);

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

    // 機密情報保護: clientKeyをログから除外
    app.log.info(
      {
        defaultMode,
        clientKey: '[REDACTED]',
        hasClientStatus: !!clientStatus
      },
      'Returning kiosk config'
    );
    const { tabOrder: navTabOrder } = await getKioskHeaderTabOrderSettings();

    return {
      theme: 'factory-dark',
      greeting: 'タグを順番にかざしてください',
      idleTimeoutMs: 30000,
      defaultMode,
      clientStatus,
      navTabOrder
    };
  });
}
