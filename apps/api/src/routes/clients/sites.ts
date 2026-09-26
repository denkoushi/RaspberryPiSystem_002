import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import { createSite, listSites } from '../../services/sites/site.service.js';
import { canManage } from './shared.js';

const createSiteBodySchema = z.object({
  key: z.string().trim().min(1).max(50),
  displayName: z.string().trim().max(50).optional(),
  sortOrder: z.number().int().min(0).max(9999).optional()
});

/** 拠点（工場）マスタ。端末の明示拠点（ClientDevice.siteKey）の選択肢。 */
export async function registerSiteRoutes(app: FastifyInstance): Promise<void> {
  app.get('/sites', { preHandler: canManage }, async () => {
    return { sites: await listSites() };
  });

  app.post('/sites', { preHandler: canManage }, async (request) => {
    const body = createSiteBodySchema.parse(request.body);
    return { site: await createSite(body) };
  });
}
