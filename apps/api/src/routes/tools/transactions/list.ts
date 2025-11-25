import type { FastifyInstance } from 'fastify';
import { authorizeRoles } from '../../../lib/auth.js';
import { TransactionService } from '../../../services/tools/transaction.service.js';
import { transactionQuerySchema } from './schemas.js';

export function registerTransactionListRoute(app: FastifyInstance, transactionService: TransactionService): void {
  const canView = authorizeRoles('ADMIN', 'MANAGER', 'VIEWER');

  app.get('/transactions', { preHandler: canView, config: { rateLimit: false } }, async (request) => {
    const query = transactionQuerySchema.parse(request.query);
    const result = await transactionService.findAll(query);
    return result;
  });
}

