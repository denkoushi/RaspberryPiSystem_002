import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { authorizeRoles } from '../../lib/auth.js';
import { LoanService } from '../../services/tools/loan.service.js';

const borrowSchema = z.object({
  itemTagUid: z.string().min(4),
  employeeTagUid: z.string().min(4),
  clientId: z.string().uuid().optional(),
  dueAt: z.coerce.date().optional(),
  note: z.string().optional().nullable()
});

const returnSchema = z.object({
  loanId: z.string().uuid(),
  clientId: z.string().uuid().optional(),
  performedByUserId: z.string().uuid().optional(),
  note: z.string().optional().nullable()
});

const activeLoanQuerySchema = z.object({
  clientId: z.string().uuid().optional()
});

export async function registerLoanRoutes(app: FastifyInstance): Promise<void> {
  const canView = authorizeRoles('ADMIN', 'MANAGER', 'VIEWER');
  const loanService = new LoanService();

  app.post('/borrow', async (request) => {
    const body = borrowSchema.parse(request.body);
    const headerKey = request.headers['x-client-key'];
    const resolvedClientId = await loanService.resolveClientId(body.clientId, headerKey);

    const loan = await loanService.borrow(body, resolvedClientId);
    return { loan };
  });

  app.post('/return', async (request) => {
    const body = returnSchema.parse(request.body);
    const headerKey = request.headers['x-client-key'];
    const resolvedClientId = await loanService.resolveClientId(body.clientId, headerKey);
    const performedByUserId = request.user?.id ?? body.performedByUserId;

    const loan = await loanService.return(body, resolvedClientId, performedByUserId);
    return { loan };
  });

  app.get('/loans/active', async (request, reply) => {
    const query = activeLoanQuerySchema.parse(request.query);
    let resolvedClientId = query.clientId;
    let allowWithoutAuth = false;

    // クライアントキーがあれば優先的にデバイス認証とみなす
    const headerKey = request.headers['x-client-key'];
    if (headerKey) {
      resolvedClientId = await loanService.resolveClientId(resolvedClientId, headerKey);
      allowWithoutAuth = true;
    } else {
      try {
        await canView(request, reply);
      } catch (error) {
        // JWT が無効でも clientId が明示されていれば許可する
        if (!resolvedClientId) {
          throw error;
        }
      }
    }

    const loans = await loanService.findActive({ clientId: resolvedClientId });

    if (allowWithoutAuth) {
      return { loans: loans.filter((loan) => loan.clientId === resolvedClientId) };
    }
    return { loans };
  });
}
