import type { FastifyInstance } from 'fastify';
import { authorizeRoles } from '../../../lib/auth.js';
import { LoanService } from '../../../services/tools/loan.service.js';
import { activeLoanQuerySchema } from './schemas.js';

export function registerActiveLoansRoute(app: FastifyInstance, loanService: LoanService): void {
  const canView = authorizeRoles('ADMIN', 'MANAGER', 'VIEWER');

  app.get('/active', { config: { rateLimit: false } }, async (request, reply) => {
    const query = activeLoanQuerySchema.parse(request.query);
    let resolvedClientId = query.clientId;
    let allowWithoutAuth = false;

    // クライアントキーがあれば優先的にデバイス認証とみなす
    const headerKey = request.headers['x-client-key'];
    if (headerKey) {
      // clientIdがクエリパラメータで指定されていない場合のみ、クライアントキーから解決
      if (!resolvedClientId) {
        resolvedClientId = await loanService.resolveClientId(undefined, headerKey);
      } else {
        // clientIdが指定されている場合は検証のみ
        await loanService.resolveClientId(resolvedClientId, headerKey);
      }
      allowWithoutAuth = true;
    } else {
      try {
        await canView(request, reply);
      } catch (error) {
        // JWT が無効でも clientId が明示されていれば許可する
        if (!resolvedClientId) {
          throw error;
        }
      }
    }

    const loans = await loanService.findActive({ clientId: resolvedClientId });

    // クライアントキー認証の場合は、clientIdが指定されている場合のみフィルタリング
    // clientIdが指定されていない場合はすべての貸出を返す（キオスクで全件表示するため）
    if (allowWithoutAuth && resolvedClientId) {
      return { loans: loans.filter((loan) => loan.clientId === resolvedClientId) };
    }
    return { loans };
  });
}

