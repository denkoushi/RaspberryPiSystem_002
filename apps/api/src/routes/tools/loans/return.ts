import type { FastifyInstance } from 'fastify';
import { LoanService } from '../../../services/tools/loan.service.js';
import { returnSchema } from './schemas.js';

export function registerReturnRoute(app: FastifyInstance, loanService: LoanService): void {
  app.post('/return', { config: { rateLimit: false } }, async (request) => {
    const body = returnSchema.parse(request.body);
    const headerKey = request.headers['x-client-key'];
    const resolvedClientId = await loanService.resolveClientId(body.clientId, headerKey);
    const performedByUserId = request.user?.id ?? body.performedByUserId;

    const loan = await loanService.return(body, resolvedClientId, performedByUserId);
    return { loan };
  });
}

