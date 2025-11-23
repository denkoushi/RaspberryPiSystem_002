import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { authorizeRoles } from '../../lib/auth.js';
import { TransactionService } from '../../services/tools/transaction.service.js';

const transactionQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  employeeId: z.string().uuid().optional(),
  itemId: z.string().uuid().optional(),
  clientId: z.string().uuid().optional(),
  startDate: z.coerce.date().optional(),
  endDate: z.coerce.date().optional()
});

export async function registerTransactionRoutes(app: FastifyInstance): Promise<void> {
  const canView = authorizeRoles('ADMIN', 'MANAGER', 'VIEWER');
  const transactionService = new TransactionService();

  app.get('/transactions', { preHandler: canView }, async (request) => {
    const query = transactionQuerySchema.parse(request.query);
    const result = await transactionService.findAll(query);
    return result;
  });
}
