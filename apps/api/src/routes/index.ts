import type { FastifyInstance } from 'fastify';
import { registerSystemRoutes } from './system/index.js';
import { registerAuthRoutes } from './auth.js';
import { registerToolsRoutes } from './tools/index.js';
import { registerClientRoutes } from './clients.js';
import { registerKioskRoutes } from './kiosk.js';
import { registerImportRoutes } from './imports.js';
import { registerStorageRoutes } from './storage/index.js';
import { registerSignageRoutes } from './signage/index.js';
import { registerMeasuringInstrumentRoutes } from './measuring-instruments/index.js';

/**
 * すべてのルートを登録
 * 
 * 注意: レート制限プラグインは完全に削除しました。
 * 429エラーが発生し続けていたため、レート制限プラグインが原因かどうかを確認するために削除しました。
 */
export async function registerRoutes(app: FastifyInstance): Promise<void> {
  await app.register(
    async (subApp) => {
      // レート制限プラグインは削除済み（429エラー対策）
      
      await registerSystemRoutes(subApp);
      await registerAuthRoutes(subApp);
      
      // ツール管理モジュール（パス: /api/tools/*）
      await registerToolsRoutes(subApp);
      // 計測機器管理モジュール（パス: /api/measuring-instruments/*）
      await registerMeasuringInstrumentRoutes(subApp);
      
      await registerClientRoutes(subApp);
      await registerKioskRoutes(subApp);
      await registerImportRoutes(subApp);
      await registerStorageRoutes(subApp);
      await registerSignageRoutes(subApp);
    },
    { prefix: '/api' },
  );
}
