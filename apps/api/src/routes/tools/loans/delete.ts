import type { FastifyInstance } from 'fastify';
import { redactHeadersForLog } from '../../../lib/log-headers.js';
import { LoanService } from '../../../services/tools/loan.service.js';
import { requireLoanClientOrJwt } from './require-loan-auth.js';
import { loanParamsSchema } from './schemas.js';

export function registerLoanDeleteRoute(app: FastifyInstance, loanService: LoanService): void {
  app.delete('/:id', { config: { rateLimit: false } }, async (request, reply) => {
    // 機密情報保護: 認証ヘッダーをログから除外
    const sanitizedHeaders = redactHeadersForLog(request.headers);
    app.log.info({ params: request.params, headers: sanitizedHeaders }, 'Loan delete request received');
    try {
      const params = loanParamsSchema.parse(request.params);
      await requireLoanClientOrJwt(request, reply, loanService, ['ADMIN', 'MANAGER']);
      await loanService.delete(params.id);
      app.log.info({ loanId: params.id }, 'Loan deleted');
      return { success: true };
    } catch (error) {
      app.log.error({ error, params: request.params }, 'Loan delete request failed');
      throw error;
    }
  });
}

