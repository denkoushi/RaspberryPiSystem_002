import type { FastifyInstance } from 'fastify';
import { registerSystemRoutes } from './system/index.js';
import { registerAuthRoutes } from './auth.js';
import { registerToolsRoutes } from './tools/index.js';
import { registerClientRoutes } from './clients.js';
import { registerKioskRoutes } from './kiosk.js';
import { registerImportRoutes } from './imports.js';

export async function registerRoutes(app: FastifyInstance): Promise<void> {
  await app.register(
    async (subApp) => {
      await registerSystemRoutes(subApp);
      await registerAuthRoutes(subApp);
      
      // ツール管理モジュール（パス: /api/tools/*）
      await registerToolsRoutes(subApp);
      
      await registerClientRoutes(subApp);
      await registerKioskRoutes(subApp);
      await registerImportRoutes(subApp);
    },
    { prefix: '/api' },
  );
}
