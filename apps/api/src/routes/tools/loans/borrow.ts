import type { FastifyInstance } from 'fastify';
import { LoanService } from '../../../services/tools/loan.service.js';
import { borrowSchema } from './schemas.js';

export function registerBorrowRoute(app: FastifyInstance, loanService: LoanService): void {
  app.post('/borrow', async (request) => {
    const body = borrowSchema.parse(request.body);
    const headerKey = request.headers['x-client-key'];
    const resolvedClientId = await loanService.resolveClientId(body.clientId, headerKey);

    const loan = await loanService.borrow(body, resolvedClientId);
    return { loan };
  });
}

