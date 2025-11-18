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
  await registerSystemRoutes(app);
  await registerAuthRoutes(app);
  await registerEmployeeRoutes(app);
  await registerItemRoutes(app);
  await registerLoanRoutes(app);
  await registerTransactionRoutes(app);
  await registerClientRoutes(app);
  await registerKioskRoutes(app);
  await registerImportRoutes(app);
}
