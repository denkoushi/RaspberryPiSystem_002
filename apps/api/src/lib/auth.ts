import jwt, { type Secret, type SignOptions } from 'jsonwebtoken';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { User } from '@prisma/client';
import { env } from '../config/env.js';
import { ApiError } from './errors.js';
import { prisma } from './prisma.js';

export interface JwtPayload {
  sub: string;
  username: string;
  role: User['role'];
  mfaEnabled?: boolean;
}

export function signAccessToken(user: User): string {
  const payload: JwtPayload = {
    sub: user.id,
    username: user.username,
    role: user.role,
    mfaEnabled: user.mfaEnabled
  };
  const secret: Secret = env.JWT_ACCESS_SECRET;
  const options: SignOptions = { expiresIn: env.TOKEN_EXPIRES_IN as SignOptions['expiresIn'] };
  return jwt.sign(payload, secret, options);
}

export function signRefreshToken(user: User): string {
  const payload: JwtPayload = {
    sub: user.id,
    username: user.username,
    role: user.role,
    mfaEnabled: user.mfaEnabled
  };
  const secret: Secret = env.JWT_REFRESH_SECRET;
  const options: SignOptions = { expiresIn: env.REFRESH_TOKEN_EXPIRES_IN as SignOptions['expiresIn'] };
  return jwt.sign(payload, secret, options);
}

export type KioskAccessPurpose = 'due-management' | 'assembly-record-approval';

function kioskAccessTokenContext(purpose: KioskAccessPurpose) {
  return {
    code: purpose.replaceAll('-', '_').toUpperCase(),
    label: purpose === 'due-management' ? '納期管理' : '組立記録確認'
  };
}

/** 照合に使ったパスワードの世代。変更されたことが無ければ 0。 */
function passwordVersionOf(passwordChangedAt: Date | null | undefined): number {
  return passwordChangedAt ? passwordChangedAt.getTime() : 0;
}

export function signKioskAccessToken(
  purpose: KioskAccessPurpose,
  clientDeviceId: string | undefined,
  expiresIn: SignOptions['expiresIn'] = '12h',
  passwordChangedAt: Date | null = null
): string {
  const { code } = kioskAccessTokenContext(purpose);
  if (!clientDeviceId) {
    throw new ApiError(403, '操作端末を特定できません', undefined, `${code}_TOKEN_INVALID`);
  }
  const pwv = passwordVersionOf(passwordChangedAt);
  return jwt.sign({ purpose, clientDeviceId, pwv, iat: Date.now() / 1000 }, env.JWT_ACCESS_SECRET, {
    algorithm: 'HS256',
    expiresIn
  });
}

export function requireKioskAccessToken(rawToken: unknown, purpose: KioskAccessPurpose, clientDeviceId: string | undefined): Promise<void> {
  const { code, label } = kioskAccessTokenContext(purpose);
  if (!rawToken) {
    throw new ApiError(403, `${label}のパスワード確認が必要です`, undefined, `${code}_TOKEN_REQUIRED`);
  }
  let payload: jwt.JwtPayload | string;
  try {
    if (typeof rawToken !== 'string') throw new Error('Invalid token header');
    payload = jwt.verify(rawToken, env.JWT_ACCESS_SECRET, { algorithms: ['HS256'] });
  } catch (error) {
    const errorCode = error instanceof jwt.TokenExpiredError ? `${code}_TOKEN_EXPIRED` : `${code}_TOKEN_INVALID`;
    throw new ApiError(403, `${label}のパスワードを再確認してください`, undefined, errorCode);
  }
  if (
    typeof payload === 'string' || payload.purpose !== purpose ||
    typeof payload.exp !== 'number' || typeof payload.iat !== 'number' || typeof payload.clientDeviceId !== 'string' ||
    (payload.pwv !== undefined && typeof payload.pwv !== 'number') ||
    payload.sub !== undefined || payload.role !== undefined
  ) {
    throw new ApiError(403, `${label}の認証が無効です`, undefined, `${code}_TOKEN_INVALID`);
  }
  if (payload.clientDeviceId !== clientDeviceId) {
    throw new ApiError(403, '操作端末でパスワードを再確認してください', undefined, `${code}_TOKEN_DEVICE_MISMATCH`);
  }
  const tokenPasswordVersion = typeof payload.pwv === 'number' ? payload.pwv : 0;
  return prisma.productionScheduleAccessPasswordConfig.findUnique({
    where: { location: 'shared' },
    select: { passwordChangedAt: true }
  }).then((config) => {
    if (tokenPasswordVersion !== passwordVersionOf(config?.passwordChangedAt)) {
      throw new ApiError(403, `${label}のパスワードを再確認してください`, undefined, `${code}_TOKEN_EXPIRED`);
    }
  });
}

export function signDueManagementToken(clientDeviceId: string | undefined, passwordChangedAt: Date | null = null): string {
  return signKioskAccessToken('due-management', clientDeviceId, '12h', passwordChangedAt);
}

export function requireDueManagementToken(rawToken: unknown, clientDeviceId: string | undefined): Promise<void> {
  return requireKioskAccessToken(rawToken, 'due-management', clientDeviceId);
}

export function isAdminMfaRequired(role: User['role']): boolean {
  return env.ADMIN_MFA_REQUIRED === true && (role === 'ADMIN' || role === 'MANAGER');
}

export async function authenticate(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const header = request.headers['authorization'];
  if (!header) {
    throw new ApiError(401, '認証トークンが必要です', undefined, 'AUTH_TOKEN_REQUIRED');
  }
  const parts = header.split(' ');
  const token = parts.length === 2 && parts[0].toLowerCase() === 'bearer' ? parts[1] : undefined;
  let payload: JwtPayload;
  try {
    if (!token) {
      throw new Error('Authorization scheme must be Bearer');
    }
    payload = jwt.verify(token, env.JWT_ACCESS_SECRET) as JwtPayload;
    if (
      typeof payload.sub !== 'string' || !payload.sub ||
      typeof payload.username !== 'string' || !payload.username ||
      typeof payload.role !== 'string'
    ) {
      throw new Error('Invalid user token claims');
    }
  } catch (error) {
    reply.code(401);
    throw new ApiError(401, 'トークンが無効です', undefined, 'AUTH_TOKEN_INVALID');
  }
  const user = await prisma.user.findUnique({
    where: { id: payload.sub },
    select: { id: true, username: true, role: true, status: true, mfaEnabled: true }
  });
  if (!user || user.status !== 'ACTIVE') {
    reply.code(401);
    throw new ApiError(401, 'トークンが無効です', undefined, 'AUTH_TOKEN_INVALID');
  }
  if (isAdminMfaRequired(user.role) && !(payload.mfaEnabled === true && user.mfaEnabled === true)) {
    const isMfaSetupRoute = request.method === 'POST' &&
      ['/api/auth/mfa/initiate', '/api/auth/mfa/activate'].includes(request.routeOptions.url ?? '');
    if (!isMfaSetupRoute) {
      throw new ApiError(403, '管理者アカウントはMFAの設定が必要です', undefined, 'MFA_SETUP_REQUIRED');
    }
  }
  request.user = { id: user.id, username: user.username, role: user.role };
}

export function authorizeRoles(...roles: User['role'][]): (request: FastifyRequest, reply: FastifyReply) => Promise<void> {
  return async (request, reply) => {
    await authenticate(request, reply);
    if (!request.user || !roles.includes(request.user.role)) {
      throw new ApiError(403, '操作権限がありません', undefined, 'AUTH_INSUFFICIENT_PERMISSIONS');
    }
  };
}
