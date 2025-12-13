import type { FastifyInstance } from 'fastify';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { ApiError } from '../lib/errors.js';
import { authorizeRoles, authenticate, signAccessToken, signRefreshToken, type JwtPayload } from '../lib/auth.js';
import { generateBackupCodes, generateTotpSecret, hashBackupCodes, matchAndConsumeBackupCode, verifyTotpCode } from '../lib/mfa.js';

import jwt from 'jsonwebtoken';
import { env } from '../config/env.js';

const loginSchema = z.object({
  username: z.string().min(1),
  password: z.string().min(1),
  totpCode: z.string().optional(),
  backupCode: z.string().optional()
});

const refreshTokenSchema = z.object({
  refreshToken: z.string().min(1)
});

const mfaInitiateSchema = z.object({
  // no input; reserved for future options
});

const mfaActivateSchema = z.object({
  secret: z.string().min(10),
  code: z.string().min(6),
  backupCodes: z.array(z.string().min(4)).min(1)
});

const mfaDisableSchema = z.object({
  password: z.string().min(1)
});

export async function registerAuthRoutes(app: FastifyInstance): Promise<void> {
  // ログイン系エンドポイントには厳格なレート制限を適用（ブルートフォース対策）
  const authRateLimit = { max: 10, timeWindow: '1 minute' };

  app.post('/auth/login', { config: { rateLimit: authRateLimit } }, async (request) => {
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

    if (user.mfaEnabled) {
      const totpOk = user.totpSecret ? verifyTotpCode(user.totpSecret, body.totpCode ?? '') : false;
      let backupOk = false;
      let remainingCodes = user.mfaBackupCodes;
      if (!totpOk && user.mfaBackupCodes.length > 0) {
        const result = await matchAndConsumeBackupCode(user.mfaBackupCodes, body.backupCode);
        backupOk = result.ok;
        remainingCodes = result.remaining;
        if (backupOk) {
          await prisma.user.update({
            where: { id: user.id },
            data: { mfaBackupCodes: remainingCodes }
          });
        }
      }
      if (!totpOk && !backupOk) {
        throw new ApiError(401, 'MFAコードが必要です');
      }
    }
    const accessToken = signAccessToken(user);
    const refreshToken = signRefreshToken(user);
    return {
      accessToken,
      refreshToken,
      user: {
        id: user.id,
        username: user.username,
        role: user.role,
        mfaEnabled: user.mfaEnabled
      }
    };
  });

  app.post('/auth/refresh', { config: { rateLimit: authRateLimit } }, async (request) => {
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
          role: user.role,
          mfaEnabled: user.mfaEnabled
        }
      };
    } catch (error) {
      if (error instanceof jwt.JsonWebTokenError || error instanceof jwt.TokenExpiredError) {
        throw new ApiError(401, 'リフレッシュトークンが無効です');
      }
      throw error;
    }
  });

  // MFA: 初期化（シークレット/バックアップコード払い出し）
  app.post('/auth/mfa/initiate', { preHandler: authorizeRoles('ADMIN', 'MANAGER') }, async (request) => {
    mfaInitiateSchema.parse(request.body ?? {});
    const user = await prisma.user.findUnique({ where: { id: request.user!.id } });
    if (!user) throw new ApiError(401, 'ユーザーが見つかりません');
    const secret = generateTotpSecret();
    const backupCodes = generateBackupCodes(10);
    const otpauthUrl = `otpauth://totp/RaspberryPiSystem:${encodeURIComponent(user.username)}?secret=${secret}&issuer=RaspberryPiSystem`;
    return { secret, otpauthUrl, backupCodes };
  });

  // MFA: 有効化
  app.post('/auth/mfa/activate', { preHandler: authorizeRoles('ADMIN', 'MANAGER') }, async (request) => {
    const body = mfaActivateSchema.parse(request.body);
    const user = await prisma.user.findUnique({ where: { id: request.user!.id } });
    if (!user) throw new ApiError(401, 'ユーザーが見つかりません');
    const ok = verifyTotpCode(body.secret, body.code);
    if (!ok) {
      throw new ApiError(400, 'MFAコードが正しくありません');
    }
    const hashedCodes = await hashBackupCodes(body.backupCodes);
    await prisma.user.update({
      where: { id: user.id },
      data: {
        mfaEnabled: true,
        totpSecret: body.secret,
        mfaBackupCodes: hashedCodes
      }
    });
    return { backupCodes: body.backupCodes };
  });

  // MFA: 無効化
  app.post('/auth/mfa/disable', { preHandler: authenticate }, async (request) => {
    const body = mfaDisableSchema.parse(request.body);
    const user = await prisma.user.findUnique({ where: { id: request.user!.id } });
    if (!user) throw new ApiError(401, 'ユーザーが見つかりません');
    const ok = await bcrypt.compare(body.password, user.passwordHash);
    if (!ok) throw new ApiError(401, 'パスワードが違います');
    await prisma.user.update({
      where: { id: user.id },
      data: {
        mfaEnabled: false,
        totpSecret: null,
        mfaBackupCodes: []
      }
    });
    return { success: true };
  });
}
