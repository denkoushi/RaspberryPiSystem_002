import type { FastifyInstance } from 'fastify';
import { registerEmployeeRoutes } from './employees.js';
import { registerItemRoutes } from './items.js';
import { registerLoanRoutes } from './loans.js';
import { registerTransactionRoutes } from './transactions.js';

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

