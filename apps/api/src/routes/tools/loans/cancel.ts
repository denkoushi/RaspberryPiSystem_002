import type { FastifyInstance } from 'fastify';
import { LoanService } from '../../../services/tools/loan.service.js';
import { cancelSchema } from './schemas.js';

export function registerLoanCancelRoute(app: FastifyInstance, loanService: LoanService): void {
  app.post('/cancel', { config: { rateLimit: false } }, async (request) => {
    app.log.info({ body: request.body, headers: request.headers }, 'Loan cancel request received');
    try {
      const body = cancelSchema.parse(request.body);
      app.log.info({ body }, 'Loan cancel request body validated');
      const headerKey = request.headers['x-client-key'];
      const resolvedClientId = await loanService.resolveClientId(body.clientId, headerKey);
      app.log.info({ resolvedClientId, headerKey }, 'Client ID resolved');
      const performedByUserId = request.user?.id ?? body.performedByUserId;

      const loan = await loanService.cancel(body.loanId, resolvedClientId, performedByUserId);
      app.log.info({ loanId: loan.id }, 'Loan cancelled');
      return { loan };
    } catch (error) {
      app.log.error({ error, body: request.body }, 'Loan cancel request failed');
      throw error;
    }
  });
}

