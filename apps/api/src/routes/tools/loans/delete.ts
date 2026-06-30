import type { FastifyInstance } from 'fastify';
import { LoanService } from '../../../services/tools/loan.service.js';
import { loanParamsSchema } from './schemas.js';
import { requireAuthorizedLoanAccess } from './auth.js';

export function registerLoanDeleteRoute(app: FastifyInstance, loanService: LoanService): void {
  app.delete('/:id', { config: { rateLimit: false } }, async (request, reply) => {
    // 機密情報保護: x-client-keyをログから除外
    const sanitizedHeaders = { ...request.headers };
    if ('x-client-key' in sanitizedHeaders) {
      sanitizedHeaders['x-client-key'] = '[REDACTED]';
    }
    app.log.info({ params: request.params, headers: sanitizedHeaders }, 'Loan delete request received');
    try {
      const params = loanParamsSchema.parse(request.params);
      await requireAuthorizedLoanAccess(request, reply, 'write');
      await loanService.delete(params.id);
      app.log.info({ loanId: params.id }, 'Loan deleted');
      return { success: true };
    } catch (error) {
      app.log.error({ error, params: request.params }, 'Loan delete request failed');
      throw error;
    }
  });
}
