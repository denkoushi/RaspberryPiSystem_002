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

export async function authenticate(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const header = request.headers['authorization'];
  if (!header) {
    throw new ApiError(401, '認証トークンが必要です', undefined, 'AUTH_TOKEN_REQUIRED');
  }
  const [, token] = header.split(' ');
  try {
    const payload = jwt.verify(token, env.JWT_ACCESS_SECRET) as JwtPayload;
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
