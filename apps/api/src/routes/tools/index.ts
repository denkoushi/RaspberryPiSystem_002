import type { FastifyInstance } from 'fastify';
import { registerEmployeeRoutes } from './employees/index.js';
import { registerItemRoutes } from './items/index.js';
import { registerLoanRoutes } from './loans/index.js';
import { registerTransactionRoutes } from './transactions/index.js';

/**
 * ツール管理モジュールのルートを登録
 * パス: /api/tools/*
 */
export async function registerToolsRoutes(app: FastifyInstance): Promise<void> {
  await app.register(
    async (subApp) => {
      await registerEmployeeRoutes(subApp);
      await registerItemRoutes(subApp);
      await registerLoanRoutes(subApp);
      await registerTransactionRoutes(subApp);
    },
    { prefix: '/tools' },
  );
}


