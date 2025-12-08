import type { FastifyInstance } from 'fastify';
import { registerEmployeeRoutes } from './employees/index.js';
import { registerItemRoutes } from './items/index.js';
import { registerLoanRoutes } from './loans/index.js';
import { registerTransactionRoutes } from './transactions/index.js';
import { registerUnifiedRoutes } from './unified/index.js';

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
      // 注意: レート制限プラグインは`routes/index.ts`で既に登録されているため、
      // ここでは登録しない（重複登録を避けるため）
      // ルートの`config: { rateLimit: false }`は親のサブルーターで登録されたプラグインで認識される

      await registerEmployeeRoutes(subApp);
      await registerItemRoutes(subApp);
      await registerLoanRoutes(subApp);
      await registerTransactionRoutes(subApp);
      await registerUnifiedRoutes(subApp);
    },
    { prefix: '/tools' },
  );
}


