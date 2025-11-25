import type { FastifyInstance } from 'fastify';
import rateLimit from '@fastify/rate-limit';
import { registerSystemRoutes } from './system/index.js';
import { registerAuthRoutes } from './auth.js';
import { registerToolsRoutes } from './tools/index.js';
import { registerClientRoutes } from './clients.js';
import { registerKioskRoutes } from './kiosk.js';
import { registerImportRoutes } from './imports.js';

/**
 * すべてのルートを登録
 * 
 * サブルーター内でレート制限プラグインを登録することで、
 * ルートの`config: { rateLimit: false }`が正しく認識されるようにします。
 * 
 * 注意: レート制限プラグインはここで1箇所のみ登録し、重複登録を避けます。
 */
export async function registerRoutes(app: FastifyInstance): Promise<void> {
  await app.register(
    async (subApp) => {
      // サブルーター内でレート制限プラグインを登録（ルートのconfigを認識させるため）
      // max: 100000で実質的に無効化（429エラーを防ぐため）
      await subApp.register(rateLimit, {
        max: 100000, // 非常に大きな値（実質的に無制限）
        timeWindow: '1 minute',
        skipOnError: false,
        addHeaders: {
          'x-ratelimit-limit': true,
          'x-ratelimit-remaining': true,
          'x-ratelimit-reset': true,
        },
        keyGenerator: (request) => {
          return request.ip || (Array.isArray(request.headers['x-forwarded-for'])
            ? request.headers['x-forwarded-for'][0]
            : request.headers['x-forwarded-for']) || 'unknown';
        },
      });

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
