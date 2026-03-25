import type { FastifyReply, FastifyRequest } from 'fastify';
import type { UserRole } from '@prisma/client';

import { authorizeRoles } from './auth.js';
import { ApiError } from './errors.js';
import { prisma } from './prisma.js';

/**
 * キオスク要領書API: 有効な x-client-key（登録端末）または JWT（指定ロール）のいずれかで閲覧を許可する。
 */
export async function authorizeKioskClientKeyOrJwtRoles(
  request: FastifyRequest,
  reply: FastifyReply,
  roles: UserRole[]
): Promise<void> {
  const headerKey = request.headers['x-client-key'];
  if (headerKey) {
    const key = typeof headerKey === 'string' ? headerKey : headerKey[0];
    const client = await prisma.clientDevice.findUnique({
      where: { apiKey: key },
    });
    if (!client) {
      throw new ApiError(401, 'クライアント API キーが不正です', undefined, 'INVALID_CLIENT_KEY');
    }
    return;
  }
  await authorizeRoles(...roles)(request, reply);
}
