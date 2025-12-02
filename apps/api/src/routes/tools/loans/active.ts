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

    // キオスク画面では、クライアントキー認証があっても全件表示する
    // （異なるAPIキーで作成された貸出も含めて表示するため）
    // clientIdがクエリパラメータで明示的に指定されている場合のみフィルタリング
    // 空文字列の場合はundefinedとして扱う（全件表示）
    const filterClientId = query.clientId && query.clientId.trim() !== '' ? query.clientId : undefined;
    const loans = await loanService.findActive({ clientId: filterClientId });

    return { loans };
  });
}

