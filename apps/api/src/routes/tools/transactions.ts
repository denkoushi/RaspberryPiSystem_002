import type { FastifyInstance } from 'fastify';
import type { Prisma } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '../../lib/prisma.js';
import { authorizeRoles } from '../../lib/auth.js';

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

  app.get('/transactions', { preHandler: canView }, async (request) => {
    const query = transactionQuerySchema.parse(request.query);
    const where: Prisma.TransactionWhereInput = {
      ...(query.employeeId ? { actorEmployeeId: query.employeeId } : {}),
      ...(query.clientId ? { clientId: query.clientId } : {}),
      ...(query.itemId
        ? {
            loan: {
              itemId: query.itemId
            }
          }
        : {}),
      ...(query.startDate || query.endDate
        ? {
            createdAt: {
              ...(query.startDate ? { gte: query.startDate } : {}),
              ...(query.endDate ? { lte: query.endDate } : {})
            }
          }
        : {})
    };

    const [total, transactions] = await prisma.$transaction([
      prisma.transaction.count({ where }),
      prisma.transaction.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        include: {
          loan: {
            include: { item: true, employee: true, client: true }
          },
          actorEmployee: true,
          performedByUser: true,
          client: true
        }
      })
    ]);

    return { transactions, total, page: query.page, pageSize: query.pageSize };
  });
}
