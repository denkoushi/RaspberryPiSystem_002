import crypto from 'crypto';
import fs from 'fs/promises';
import path from 'path';
import type { FastifyInstance } from 'fastify';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { ApiError } from '../lib/errors.js';
import { authorizeRoles, authenticate, signAccessToken, signRefreshToken, type JwtPayload } from '../lib/auth.js';
import { generateBackupCodes, generateTotpSecret, hashBackupCodes, matchAndConsumeBackupCode, verifyTotpCode } from '../lib/mfa.js';
import { UserRole } from '@prisma/client';

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

const updateRoleSchema = z.object({
  role: z.enum(['ADMIN', 'MANAGER', 'VIEWER'])
});

const auditQuerySchema = z.object({
  limit: z.coerce.number().min(1).max(200).optional()
});

const businessHourStart = Number.parseInt(process.env.BUSINESS_HOUR_START ?? '8', 10);
const businessHourEnd = Number.parseInt(process.env.BUSINESS_HOUR_END ?? '20', 10);

function isOutsideBusinessHours(now: Date): boolean {
  const hour = now.getHours();
  return hour < businessHourStart || hour >= businessHourEnd;
}

async function emitRoleChangeAlert(options: {
  actorUserId: string;
  actorUsername?: string;
  targetUserId: string;
  targetUsername: string;
  fromRole: UserRole;
  toRole: UserRole;
  reasons: string[];
  logger: FastifyInstance['log'];
}) {
  const alertsDir = process.env.ALERTS_DIR ?? path.join(process.cwd(), 'alerts');
  const id = crypto.randomUUID();
  const alert = {
    id,
    type: 'role_change',
    severity: 'warning',
    message: `権限変更: ${options.targetUsername} を ${options.fromRole} から ${options.toRole} に変更 (by ${options.actorUsername ?? options.actorUserId})`,
    reasons: options.reasons,
    details: {
      actorUserId: options.actorUserId,
      actorUsername: options.actorUsername,
      targetUserId: options.targetUserId,
      targetUsername: options.targetUsername,
      fromRole: options.fromRole,
      toRole: options.toRole
    },
    timestamp: new Date().toISOString(),
    acknowledged: false
  };
  try {
    await fs.mkdir(alertsDir, { recursive: true });
    const filePath = path.join(alertsDir, `alert-${id}.json`);
    await fs.writeFile(filePath, JSON.stringify(alert, null, 2), 'utf-8');
  } catch (error) {
    options.logger.warn({ err: error, alert }, 'Failed to write role change alert');
  }
}

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

  // 権限変更（監査ログを記録）
  app.post('/auth/users/:id/role', { preHandler: authorizeRoles('ADMIN') }, async (request) => {
    const params = z.object({ id: z.string().uuid() }).parse(request.params);
    const body = updateRoleSchema.parse(request.body);
    const target = await prisma.user.findUnique({ where: { id: params.id } });
    if (!target) throw new ApiError(404, 'ユーザーが見つかりません');
    if (target.role === body.role) {
      return { user: { id: target.id, username: target.username, role: target.role, mfaEnabled: target.mfaEnabled } };
    }
    const updated = await prisma.$transaction(async (tx) => {
      const next = await tx.user.update({
        where: { id: params.id },
        data: { role: body.role as UserRole }
      });
      await tx.roleAuditLog.create({
        data: {
          actorUserId: request.user!.id,
          targetUserId: params.id,
          fromRole: target.role as UserRole,
          toRole: body.role as UserRole
        }
      });
      return next;
    });

    const now = new Date();
    const reasons: string[] = [];
    if (request.user!.id === params.id) {
      reasons.push('self-role-change');
    }
    if (target.role !== 'ADMIN' && body.role === 'ADMIN') {
      reasons.push('promotion-to-admin');
    }
    if (isOutsideBusinessHours(now)) {
      reasons.push('outside-business-hours');
    }

    if (reasons.length > 0) {
      void emitRoleChangeAlert({
        actorUserId: request.user!.id,
        actorUsername: request.user!.username,
        targetUserId: params.id,
        targetUsername: target.username,
        fromRole: target.role as UserRole,
        toRole: body.role as UserRole,
        reasons,
        logger: request.server.log
      });
    }

    return { user: { id: updated.id, username: updated.username, role: updated.role, mfaEnabled: updated.mfaEnabled } };
  });

  // 権限変更の監査ログ一覧
  app.get('/auth/role-audit', { preHandler: authorizeRoles('ADMIN') }, async (request) => {
    const query = auditQuerySchema.parse(request.query);
    const limit = query.limit ?? 100;
    const logs = await prisma.roleAuditLog.findMany({
      orderBy: { createdAt: 'desc' },
      take: limit,
      include: {
        actorUser: { select: { id: true, username: true } },
        targetUser: { select: { id: true, username: true } }
      }
    });
    return { logs };
  });
}
