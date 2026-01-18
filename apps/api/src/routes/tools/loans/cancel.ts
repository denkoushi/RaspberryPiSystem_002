import type { FastifyInstance } from 'fastify';
import { LoanService } from '../../../services/tools/loan.service.js';
import { cancelSchema } from './schemas.js';

export function registerLoanCancelRoute(app: FastifyInstance, loanService: LoanService): void {
  app.post('/cancel', { config: { rateLimit: false } }, async (request) => {
    // 機密情報保護: x-client-keyをログから除外
    const sanitizedHeaders = { ...request.headers };
    if ('x-client-key' in sanitizedHeaders) {
      sanitizedHeaders['x-client-key'] = '[REDACTED]';
    }
    app.log.info({ body: request.body, headers: sanitizedHeaders }, 'Loan cancel request received');
    try {
      const body = cancelSchema.parse(request.body);
      app.log.info({ body }, 'Loan cancel request body validated');
      const headerKey = request.headers['x-client-key'];
      const resolvedClientId = await loanService.resolveClientId(body.clientId, headerKey);
      // 機密情報保護: headerKeyをログから除外
      app.log.info({ resolvedClientId, headerKey: '[REDACTED]' }, 'Client ID resolved');
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

