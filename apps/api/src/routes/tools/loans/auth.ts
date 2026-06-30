import type { FastifyReply, FastifyRequest } from 'fastify';

import { authorizeRoles } from '../../../lib/auth.js';
import { normalizeClientKey } from '../../../lib/client-key.js';
import { ApiError } from '../../../lib/errors.js';
import { resolveClientDeviceId } from '../../../services/clients/client-device-resolution.service.js';

const canReadLoans = authorizeRoles('ADMIN', 'MANAGER', 'VIEWER');
const canWriteLoans = authorizeRoles('ADMIN', 'MANAGER');

type LoanAccessMode = 'read' | 'write';

export async function resolveAuthorizedLoanClientId(
  request: FastifyRequest,
  reply: FastifyReply,
  requestedClientId: string | undefined,
  mode: LoanAccessMode,
): Promise<string | undefined> {
  const clientKey = normalizeClientKey(request.headers['x-client-key']);
  if (clientKey) {
    const authenticatedClientId = await resolveClientDeviceId(undefined, clientKey);
    if (requestedClientId && requestedClientId !== authenticatedClientId) {
      throw new ApiError(
        403,
        'クライアントIDとクライアントキーが一致しません',
        undefined,
        'CLIENT_KEY_CLIENT_MISMATCH',
      );
    }
    return authenticatedClientId;
  }

  if (request.headers.authorization) {
    const authorize = mode === 'read' ? canReadLoans : canWriteLoans;
    await authorize(request, reply);
    return requestedClientId ? resolveClientDeviceId(requestedClientId, undefined) : undefined;
  }

  throw new ApiError(
    401,
    '認証トークンまたはクライアントキーが必要です',
    undefined,
    'AUTH_OR_CLIENT_KEY_REQUIRED',
  );
}

export async function requireAuthorizedLoanAccess(
  request: FastifyRequest,
  reply: FastifyReply,
  mode: LoanAccessMode,
): Promise<void> {
  await resolveAuthorizedLoanClientId(request, reply, undefined, mode);
}
