import type { FastifyInstance } from 'fastify';
import { registerSystemRoutes } from './system.js';
import { registerAuthRoutes } from './auth.js';
import { registerEmployeeRoutes } from './employees.js';
import { registerItemRoutes } from './items.js';
import { registerLoanRoutes } from './loans.js';
import { registerTransactionRoutes } from './transactions.js';
import { registerClientRoutes } from './clients.js';
import { registerKioskRoutes } from './kiosk.js';
import { registerImportRoutes } from './imports.js';

export async function registerRoutes(app: FastifyInstance): Promise<void> {
  await app.register(
    async (subApp) => {
      await registerSystemRoutes(subApp);
      await registerAuthRoutes(subApp);
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
