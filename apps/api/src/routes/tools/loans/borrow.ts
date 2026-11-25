import { toLoanResponse } from '../../../lib/loan-response.js';
import type { FastifyInstance } from 'fastify';
import { LoanService } from '../../../services/tools/loan.service.js';
import { borrowSchema } from './schemas.js';
import { TERMINAL_ROUTE_RATE_LIMIT } from '../../../lib/terminal-route-rate-limit.js';

export function registerBorrowRoute(app: FastifyInstance, loanService: LoanService): void {
  app.post('/borrow', { config: { rateLimit: TERMINAL_ROUTE_RATE_LIMIT } }, async (request) => {
    const body = borrowSchema.parse(request.body);
    const headerKey = request.headers['x-client-key'];
    const resolvedClientId = await loanService.resolveClientId(body.clientId, headerKey);

    const loan = await loanService.borrow(body, resolvedClientId);
    return { loan: toLoanResponse(loan) };
  });
}

