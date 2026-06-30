import type { FastifyInstance } from 'fastify';
import { LoanService } from '../../../services/tools/loan.service.js';
import { activeLoanQuerySchema } from './schemas.js';
import { resolveAuthorizedLoanClientId } from './auth.js';

export function registerActiveLoansRoute(app: FastifyInstance, loanService: LoanService): void {
  app.get('/active', { config: { rateLimit: false } }, async (request, reply) => {
    const query = activeLoanQuerySchema.parse(request.query);
    await resolveAuthorizedLoanClientId(request, reply, query.clientId, 'read');

    // キオスク画面では、クライアントキー認証があっても全件表示する
    // （異なるAPIキーで作成された貸出も含めて表示するため）
    // clientIdがクエリパラメータで明示的に指定されている場合のみフィルタリング
    // 空文字列の場合はundefinedとして扱う（全件表示）
    const filterClientId = query.clientId && query.clientId.trim() !== '' ? query.clientId : undefined;
    const loans = await loanService.findActive({ clientId: filterClientId });

    return { loans };
  });
}
