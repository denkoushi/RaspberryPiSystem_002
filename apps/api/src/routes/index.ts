import type { FastifyInstance } from 'fastify';
import { registerSystemRoutes } from './system.js';
import { registerAuthRoutes } from './auth.js';
import { registerToolsRoutes } from './tools/index.js';
import { registerClientRoutes } from './clients.js';
import { registerKioskRoutes } from './kiosk.js';
import { registerImportRoutes } from './imports.js';

// 後方互換性のため、既存のルートも登録（リダイレクト用）
import { registerEmployeeRoutes } from './tools/employees.js';
import { registerItemRoutes } from './tools/items.js';
import { registerLoanRoutes } from './tools/loans.js';
import { registerTransactionRoutes } from './tools/transactions.js';

export async function registerRoutes(app: FastifyInstance): Promise<void> {
  await app.register(
    async (subApp) => {
      await registerSystemRoutes(subApp);
      await registerAuthRoutes(subApp);
      
      // ツール管理モジュール（新パス: /api/tools/*）
      await registerToolsRoutes(subApp);
      
      // 後方互換性のため、既存パスも維持（/api/employees など）
      await registerEmployeeRoutes(subApp);
      await registerItemRoutes(subApp);
      await registerLoanRoutes(subApp);
      await registerTransactionRoutes(subApp);
      
      await registerClientRoutes(subApp);
      await registerKioskRoutes(subApp);
      await registerImportRoutes(subApp);
    },
    { prefix: '/api' },
  );
}
