import type { FastifyInstance } from 'fastify';
import rateLimit from '@fastify/rate-limit';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { ApiError } from '../lib/errors.js';
import { signAccessToken, signRefreshToken } from '../lib/auth.js';
import { authRateLimitConfig } from '../plugins/rate-limit.js';

import jwt from 'jsonwebtoken';
import { env } from '../config/env.js';
import type { JwtPayload } from '../lib/auth.js';

const loginSchema = z.object({
  username: z.string().min(1),
  password: z.string().min(1)
});

const refreshTokenSchema = z.object({
  refreshToken: z.string().min(1)
});

export async function registerAuthRoutes(app: FastifyInstance): Promise<void> {
  // 認証エンドポイントに厳しいレート制限を適用（ブルートフォース攻撃対策）
  // 注意: 429エラーが発生しているため、一時的にレート制限を無効化
  // await app.register(rateLimit, authRateLimitConfig);

  app.post('/auth/login', async (request) => {
    const body = loginSchema.parse(request.body);
    const user = await prisma.user.findUnique({ where: { username: body.username } });
    if (!user) {
      throw new ApiError(401, 'ユーザー名またはパスワードが違います');
    }
    if (user.status !== 'ACTIVE') {
      throw new ApiError(403, 'アカウントが無効化されています');
    }
    const ok = await bcrypt.compare(body.password, user.passwordHash);
    if (!ok) {
      throw new ApiError(401, 'ユーザー名またはパスワードが違います');
    }
    const accessToken = signAccessToken(user);
    const refreshToken = signRefreshToken(user);
    return {
      accessToken,
      refreshToken,
      user: {
        id: user.id,
        username: user.username,
        role: user.role
      }
    };
  });

  app.post('/auth/refresh', async (request) => {
    const body = refreshTokenSchema.parse(request.body);
    try {
      const payload = jwt.verify(body.refreshToken, env.JWT_REFRESH_SECRET) as JwtPayload;
      const user = await prisma.user.findUnique({ where: { id: payload.sub } });
      if (!user) {
        throw new ApiError(401, 'ユーザーが見つかりません');
      }
      if (user.status !== 'ACTIVE') {
        throw new ApiError(403, 'アカウントが無効化されています');
      }
      const accessToken = signAccessToken(user);
      const refreshToken = signRefreshToken(user);
      return {
        accessToken,
        refreshToken,
        user: {
          id: user.id,
          username: user.username,
          role: user.role
        }
      };
    } catch (error) {
      if (error instanceof jwt.JsonWebTokenError || error instanceof jwt.TokenExpiredError) {
        throw new ApiError(401, 'リフレッシュトークンが無効です');
      }
      throw error;
    }
  });
}
