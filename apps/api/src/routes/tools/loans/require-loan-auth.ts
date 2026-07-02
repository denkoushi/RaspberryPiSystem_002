import type { FastifyRequest, FastifyReply } from 'fastify';
import type { User } from '@prisma/client';
import { authorizeRoles } from '../../../lib/auth.js';
import type { LoanService } from '../../../services/tools/loan.service.js';

/**
 * 貸出系エンドポイントの後方互換な認可。
 * - 有効な x-client-key があれば許可（キオスク経路）
 * - なければ JWT ロール認証（管理画面経路）
 * - どちらも無ければ 401（完全無認証を遮断）
 */
export async function requireLoanClientOrJwt(
  request: FastifyRequest,
  reply: FastifyReply,
  loanService: LoanService,
  roles: User['role'][],
): Promise<void> {
  const rawKey = request.headers['x-client-key'];
  const headerKey = Array.isArray(rawKey) ? rawKey[0] : rawKey;
  if (headerKey && headerKey.trim() !== '') {
    // 無効キーは resolveClientId が 401 を投げる
    await loanService.resolveClientId(undefined, headerKey);
    return;
  }
  await authorizeRoles(...roles)(request, reply);
}
