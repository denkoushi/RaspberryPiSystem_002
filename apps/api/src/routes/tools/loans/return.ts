import type { FastifyInstance } from 'fastify';
import { LoanService } from '../../../services/tools/loan.service.js';
import { returnSchema } from './schemas.js';

export function registerReturnRoute(app: FastifyInstance, loanService: LoanService): void {
  app.post('/return', { config: { rateLimit: false } }, async (request) => {
    // 機密情報保護: x-client-keyをログから除外
    const sanitizedHeaders = { ...request.headers };
    if ('x-client-key' in sanitizedHeaders) {
      sanitizedHeaders['x-client-key'] = '[REDACTED]';
    }
    app.log.info({ body: request.body, headers: sanitizedHeaders }, 'Return request received');
    try {
      const body = returnSchema.parse(request.body);
      app.log.info({ body }, 'Return request body validated');
      const headerKey = request.headers['x-client-key'];
      const resolvedClientId = await loanService.resolveClientId(body.clientId, headerKey);
      // 機密情報保護: headerKeyをログから除外
      app.log.info({ resolvedClientId, headerKey: '[REDACTED]' }, 'Client ID resolved');
      const performedByUserId = request.user?.id ?? body.performedByUserId;

      const loan = await loanService.return(body, resolvedClientId, performedByUserId);
      app.log.info({ loanId: loan.id }, 'Return completed');
      return { loan };
    } catch (error) {
      app.log.error({ error, body: request.body }, 'Return request failed');
      throw error;
    }
  });
}

