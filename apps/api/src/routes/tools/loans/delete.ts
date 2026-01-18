import type { FastifyInstance } from 'fastify';
import { LoanService } from '../../../services/tools/loan.service.js';
import { loanParamsSchema } from './schemas.js';

export function registerLoanDeleteRoute(app: FastifyInstance, loanService: LoanService): void {
  app.delete('/:id', { config: { rateLimit: false } }, async (request) => {
    // 機密情報保護: x-client-keyをログから除外
    const sanitizedHeaders = { ...request.headers };
    if ('x-client-key' in sanitizedHeaders) {
      sanitizedHeaders['x-client-key'] = '[REDACTED]';
    }
    app.log.info({ params: request.params, headers: sanitizedHeaders }, 'Loan delete request received');
    try {
      const params = loanParamsSchema.parse(request.params);
      // client-keyがあれば認証をスキップ（キオスク画面からのアクセス）
      const headerKey = request.headers['x-client-key'];
      if (headerKey) {
        // client-keyの有効性を確認（LoanService.resolveClientIdを使用）
        await loanService.resolveClientId(undefined, headerKey);
      }
      await loanService.delete(params.id);
      app.log.info({ loanId: params.id }, 'Loan deleted');
      return { success: true };
    } catch (error) {
      app.log.error({ error, params: request.params }, 'Loan delete request failed');
      throw error;
    }
  });
}

