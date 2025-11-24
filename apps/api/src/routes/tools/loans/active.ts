import type { FastifyInstance } from 'fastify';
import { authorizeRoles } from '../../../lib/auth.js';
import { LoanService } from '../../../services/tools/loan.service.js';
import { activeLoanQuerySchema } from './schemas.js';

export function registerActiveLoansRoute(app: FastifyInstance, loanService: LoanService): void {
  const canView = authorizeRoles('ADMIN', 'MANAGER', 'VIEWER');

  app.get('/active', async (request, reply) => {
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

