import jwt, { type Secret, type SignOptions } from 'jsonwebtoken';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { User } from '@prisma/client';
import { env } from '../config/env.js';
import { ApiError } from './errors.js';

export interface JwtPayload {
  sub: string;
  username: string;
  role: User['role'];
}

export function signAccessToken(user: User): string {
  const payload: JwtPayload = {
    sub: user.id,
    username: user.username,
    role: user.role
  };
  const secret: Secret = env.JWT_ACCESS_SECRET;
  const options: SignOptions = { expiresIn: env.TOKEN_EXPIRES_IN as SignOptions['expiresIn'] };
  return jwt.sign(payload, secret, options);
}

export function signRefreshToken(user: User): string {
  const payload: JwtPayload = {
    sub: user.id,
    username: user.username,
    role: user.role
  };
  const secret: Secret = env.JWT_REFRESH_SECRET;
  const options: SignOptions = { expiresIn: env.REFRESH_TOKEN_EXPIRES_IN as SignOptions['expiresIn'] };
  return jwt.sign(payload, secret, options);
}

export function signDueManagementToken(clientDeviceId: string | undefined): string {
  if (!clientDeviceId) {
    throw new ApiError(403, '操作端末を特定できません', undefined, 'DUE_MANAGEMENT_TOKEN_INVALID');
  }
  return jwt.sign({ purpose: 'due-management', clientDeviceId }, env.JWT_ACCESS_SECRET, {
    algorithm: 'HS256',
    expiresIn: '12h'
  });
}

export function requireDueManagementToken(rawToken: unknown, clientDeviceId: string | undefined): void {
  if (!rawToken) {
    throw new ApiError(403, '納期管理のパスワード確認が必要です', undefined, 'DUE_MANAGEMENT_TOKEN_REQUIRED');
  }
  let payload: jwt.JwtPayload | string;
  try {
    if (typeof rawToken !== 'string') throw new Error('Invalid token header');
    payload = jwt.verify(rawToken, env.JWT_ACCESS_SECRET, { algorithms: ['HS256'] });
  } catch (error) {
    const code = error instanceof jwt.TokenExpiredError ? 'DUE_MANAGEMENT_TOKEN_EXPIRED' : 'DUE_MANAGEMENT_TOKEN_INVALID';
    throw new ApiError(403, '納期管理のパスワードを再確認してください', undefined, code);
  }
  if (
    typeof payload === 'string' || payload.purpose !== 'due-management' ||
    typeof payload.exp !== 'number' || typeof payload.clientDeviceId !== 'string' ||
    payload.sub !== undefined || payload.role !== undefined
  ) {
    throw new ApiError(403, '納期管理の認証が無効です', undefined, 'DUE_MANAGEMENT_TOKEN_INVALID');
  }
  if (payload.clientDeviceId !== clientDeviceId) {
    throw new ApiError(403, '操作端末でパスワードを再確認してください', undefined, 'DUE_MANAGEMENT_TOKEN_DEVICE_MISMATCH');
  }
}

export async function authenticate(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const header = request.headers['authorization'];
  if (!header) {
    throw new ApiError(401, '認証トークンが必要です', undefined, 'AUTH_TOKEN_REQUIRED');
  }
  const [, token] = header.split(' ');
  try {
    const payload = jwt.verify(token, env.JWT_ACCESS_SECRET) as JwtPayload;
    if (
      typeof payload.sub !== 'string' || !payload.sub ||
      typeof payload.username !== 'string' || !payload.username ||
      typeof payload.role !== 'string'
    ) {
      throw new Error('Invalid user token claims');
    }
    request.user = { id: payload.sub, username: payload.username, role: payload.role };
  } catch (error) {
    reply.code(401);
    throw new ApiError(401, 'トークンが無効です', undefined, 'AUTH_TOKEN_INVALID');
  }
}

export function authorizeRoles(...roles: User['role'][]): (request: FastifyRequest, reply: FastifyReply) => Promise<void> {
  return async (request, reply) => {
    await authenticate(request, reply);
    if (!request.user || !roles.includes(request.user.role)) {
      throw new ApiError(403, '操作権限がありません', undefined, 'AUTH_INSUFFICIENT_PERMISSIONS');
    }
  };
}
