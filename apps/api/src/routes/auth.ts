import type { FastifyInstance } from 'fastify';
import rateLimit from '@fastify/rate-limit';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { ApiError } from '../lib/errors.js';
import { signAccessToken, signRefreshToken } from '../lib/auth.js';
import { authRateLimitConfig } from '../plugins/rate-limit.js';

const loginSchema = z.object({
  username: z.string().min(1),
  password: z.string().min(1)
});

export async function registerAuthRoutes(app: FastifyInstance): Promise<void> {
  // 認証エンドポイントに厳しいレート制限を適用（ブルートフォース攻撃対策）
  await app.register(rateLimit, authRateLimitConfig);

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
}
