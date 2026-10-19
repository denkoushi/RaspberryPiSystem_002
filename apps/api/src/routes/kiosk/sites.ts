import type { FastifyInstance } from 'fastify';

import { listSites } from '../../services/sites/site.service.js';

type KioskSitesRouteDeps = {
  requireClientDevice: (rawClientKey: unknown) => Promise<unknown>;
};

/** キオスク（Mac の代理操作など）の拠点選択肢。管理画面で登録した拠点をそのまま返す。 */
export async function registerKioskSitesRoute(app: FastifyInstance, deps: KioskSitesRouteDeps): Promise<void> {
  app.get('/kiosk/sites', { config: { rateLimit: false } }, async (request) => {
    await deps.requireClientDevice(request.headers['x-client-key']);
    return { sites: await listSites() };
  });
}
