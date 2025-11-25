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
      // allowList関数で、ダッシュボード・履歴ページ・キオスクエンドポイントを除外
      await subApp.register(rateLimit, {
        max: 100, // デフォルト: 100リクエスト/分
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
        // allowList関数で、特定のパスをレート制限から除外
        allowList: (request, key) => {
          const path = request.url.split('?')[0]; // クエリパラメータを除去
          // ダッシュボード・履歴ページ・キオスクエンドポイントを除外
          const skipPaths = [
            '/api/tools/employees',
            '/api/tools/items',
            '/api/tools/transactions',
            '/api/tools/loans/active',
            '/api/tools/loans/borrow',
            '/api/tools/loans/return',
            '/api/kiosk/config',
            '/api/imports',
          ];
          
          // 完全一致またはプレフィックスマッチ
          for (const skipPath of skipPaths) {
            if (path === skipPath || path.startsWith(skipPath + '/')) {
              return true; // レート制限をスキップ
            }
          }
          
          // 削除エンドポイント（パラメータ付き）
          if (path.match(/^\/api\/tools\/(employees|items)\/[^/]+$/)) {
            return true; // レート制限をスキップ
          }
          
          return false; // レート制限を適用
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
