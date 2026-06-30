import type { FastifyInstance } from 'fastify';
import { LoanService } from '../../../services/tools/loan.service.js';
import { borrowSchema } from './schemas.js';
import { resolveAuthorizedLoanClientId } from './auth.js';

export function registerBorrowRoute(app: FastifyInstance, loanService: LoanService): void {
  app.post('/borrow', { config: { rateLimit: false } }, async (request, reply) => {
    const body = borrowSchema.parse(request.body);
    const resolvedClientId = await resolveAuthorizedLoanClientId(request, reply, body.clientId, 'write');

    const loan = await loanService.borrow(body, resolvedClientId);
    return { loan };
  });
}
