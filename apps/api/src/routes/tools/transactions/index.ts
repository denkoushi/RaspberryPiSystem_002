import type { FastifyInstance } from 'fastify';
import { TransactionService } from '../../../services/tools/transaction.service.js';
import { registerTransactionListRoute } from './list.js';

export async function registerTransactionRoutes(app: FastifyInstance): Promise<void> {
  const transactionService = new TransactionService();

  registerTransactionListRoute(app, transactionService);
}

