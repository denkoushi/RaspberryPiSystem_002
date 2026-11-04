import type { FastifyInstance } from 'fastify';
import { authorizeRoles } from '../../../lib/auth.js';
import { redactHeadersForLog } from '../../../lib/log-headers.js';
import { LoanService } from '../../../services/tools/loan.service.js';
import { loanParamsSchema } from './schemas.js';

export function registerLoanDeleteRoute(app: FastifyInstance, loanService: LoanService): void {
  // 管理者だけの物理削除のため、ルート単位のレート制限を明示する
  app.delete('/:id', { config: { rateLimit: { max: 30, timeWindow: '1 minute' } } }, async (request, reply) => {
    // 機密情報保護: 認証ヘッダーをログから除外
    const sanitizedHeaders = redactHeadersForLog(request.headers);
    app.log.info({ params: request.params, headers: sanitizedHeaders }, 'Loan delete request received');
    try {
      const params = loanParamsSchema.parse(request.params);
      // 貸出記録の物理削除は管理操作のため、キオスクの x-client-key では許可せず JWT ロールを必須とする
      await authorizeRoles('ADMIN', 'MANAGER')(request, reply);
      await loanService.delete(params.id);
      app.log.info({ loanId: params.id }, 'Loan deleted');
      return { success: true };
    } catch (error) {
      app.log.error({ error, params: request.params }, 'Loan delete request failed');
      throw error;
    }
  });
}

