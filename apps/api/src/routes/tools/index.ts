import type { FastifyInstance } from 'fastify';
import rateLimit from '@fastify/rate-limit';
import { registerEmployeeRoutes } from './employees/index.js';
import { registerItemRoutes } from './items/index.js';
import { registerLoanRoutes } from './loans/index.js';
import { registerTransactionRoutes } from './transactions/index.js';

/**
 * ツール管理モジュールのルートを登録
 * パス: /api/tools/*
 * 
 * サブルーター内でレート制限プラグインを登録することで、
 * ルートの`config: { rateLimit: false }`が正しく認識されるようにします。
 */
export async function registerToolsRoutes(app: FastifyInstance): Promise<void> {
  await app.register(
    async (subApp) => {
      // サブルーター内でレート制限プラグインを登録（ルートのconfigを認識させるため）
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

      await registerEmployeeRoutes(subApp);
      await registerItemRoutes(subApp);
      await registerLoanRoutes(subApp);
      await registerTransactionRoutes(subApp);
    },
    { prefix: '/tools' },
  );
}


