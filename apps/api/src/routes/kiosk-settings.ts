import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import { authorizeRoles } from '../lib/auth.js';
import {
  getKioskHeaderTabOrderSettings,
  upsertKioskHeaderTabOrderSettings
} from '../services/kiosk/kiosk-header-tab-order.service.js';

const navTabOrderBodySchema = z.object({
  tabOrder: z.array(z.string().min(1).max(64)).max(64)
});

export function registerKioskSettingsRoutes(app: FastifyInstance): void {
  const canManage = authorizeRoles('ADMIN', 'MANAGER');

  app.get('/kiosk-settings/nav-tab-order', { preHandler: canManage }, async () => {
    const settings = await getKioskHeaderTabOrderSettings();
    return { settings };
  });

  app.put('/kiosk-settings/nav-tab-order', { preHandler: canManage }, async (request) => {
    const body = navTabOrderBodySchema.parse(request.body);
    const settings = await upsertKioskHeaderTabOrderSettings(body.tabOrder);
    return { settings };
  });
}
