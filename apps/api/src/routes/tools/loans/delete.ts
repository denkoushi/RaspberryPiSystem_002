import type { FastifyInstance } from 'fastify';
import { LoanService } from '../../../services/tools/loan.service.js';
import { loanParamsSchema } from './schemas.js';

export function registerLoanDeleteRoute(app: FastifyInstance, loanService: LoanService): void {
  app.delete('/:id', { config: { rateLimit: false } }, async (request) => {
    app.log.info({ params: request.params }, 'Loan delete request received');
    try {
      const params = loanParamsSchema.parse(request.params);
      await loanService.delete(params.id);
      app.log.info({ loanId: params.id }, 'Loan deleted');
      return { success: true };
    } catch (error) {
      app.log.error({ error, params: request.params }, 'Loan delete request failed');
      throw error;
    }
  });
}

