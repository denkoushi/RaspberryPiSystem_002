import type { User, UserRole } from '@prisma/client';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { env } from '../../config/env.js';
import { isAdminMfaRequired, signAccessToken, signRefreshToken, type JwtPayload } from '../../lib/auth.js';
import { logger } from '../../lib/logger.js';
import { ApiError } from '../../lib/errors.js';
import {
  generateBackupCodes,
  generateTotpSecret,
  hashBackupCodes,
  matchAndConsumeBackupCode,
  verifyTotpCode,
  verifyTotpCodeStep,
} from '../../lib/mfa.js';
import { prisma } from '../../lib/prisma.js';
import { LOGIN_ATTEMPT_LIMIT, notifyLoginAttemptLimitReached } from './login-limit-alert.js';

export type LoginInput = {
  username: string;
  password: string;
  totpCode?: string;
  backupCode?: string;
  rememberMe?: boolean;
};

export type AuthUserDto = {
  id: string;
  username: string;
  role: UserRole;
  mfaEnabled: boolean;
  mfaSetupRequired: boolean;
  mfaRequired: boolean;
};

export type LoginResult = {
  accessToken: string;
  refreshToken: string;
  user: AuthUserDto;
};

export type RefreshInput = {
  refreshToken: string;
};

export type MfaInitiateResult = {
  secret: string;
  otpauthUrl: string;
  backupCodes: string[];
};

export type MfaActivateInput = {
  password: string;
  currentCode?: string;
  currentBackupCode?: string;
  secret: string;
  code: string;
  backupCodes: string[];
};

export type MfaActivateResult = LoginResult & {
  backupCodes: string[];
};

export type MfaDisableInput = {
  password: string;
};

export type MfaDisableResult = {
  success: true;
};

export type RoleAuditLogDto = {
  id: string;
  actorUserId: string;
  targetUserId: string;
  fromRole: UserRole;
  toRole: UserRole;
  createdAt: Date;
  actorUser: { id: string; username: string };
  targetUser: { id: string; username: string };
};

export type RoleAuditResult = {
  logs: RoleAuditLogDto[];
};

function toAuthUserDto(user: Pick<User, 'id' | 'username' | 'role' | 'mfaEnabled'>): AuthUserDto {
  return {
    id: user.id,
    username: user.username,
    role: user.role,
    mfaEnabled: user.mfaEnabled,
    mfaSetupRequired: isAdminMfaRequired(user.role) && !user.mfaEnabled,
    mfaRequired: isAdminMfaRequired(user.role),
  };
}

function buildTokenPair(user: User): Pick<LoginResult, 'accessToken' | 'refreshToken'> {
  return {
    accessToken: signAccessToken(user),
    refreshToken: signRefreshToken(user),
  };
}

const MAX_LOGIN_USERNAME_LENGTH = 128;
const DUMMY_PASSWORD_HASH = '$2a$10$0aHEpcYrWdHZqOlUGHK9pOJIATM.o8owRzLFFGc6JqgFhSBRpJwdu';

async function deleteExpiredLoginAttempts(username: string): Promise<void> {
  await prisma.$executeRaw`
    DELETE FROM "AuthLoginAttempt" WHERE "username" IN (
      SELECT "username" FROM "AuthLoginAttempt"
      WHERE "windowEndsAt" <= (statement_timestamp() AT TIME ZONE 'UTC')
        AND "username" <> ${username}
      ORDER BY "windowEndsAt"
      LIMIT 100 FOR UPDATE SKIP LOCKED
    )
  `;
}

async function reserveLoginAttempt(username: string): Promise<number> {
  try {
    await deleteExpiredLoginAttempts(username);
  } catch (error) {
    logger.warn({ err: error }, 'Failed to delete expired login attempts');
  }
  const reserved = await prisma.$queryRaw<Array<{ username: string; count: number }>>`
    INSERT INTO "AuthLoginAttempt" ("username", "count", "windowEndsAt", "updatedAt")
    VALUES (${username}, 1,
      (statement_timestamp() AT TIME ZONE 'UTC') + INTERVAL '15 minutes',
      (statement_timestamp() AT TIME ZONE 'UTC'))
    ON CONFLICT ("username") DO UPDATE SET
      "count" = CASE
        WHEN "AuthLoginAttempt"."windowEndsAt" <= (statement_timestamp() AT TIME ZONE 'UTC') THEN 1
        ELSE "AuthLoginAttempt"."count" + 1 END,
      "windowEndsAt" = CASE
        WHEN "AuthLoginAttempt"."windowEndsAt" <= (statement_timestamp() AT TIME ZONE 'UTC')
          THEN (statement_timestamp() AT TIME ZONE 'UTC') + INTERVAL '15 minutes'
        ELSE "AuthLoginAttempt"."windowEndsAt" END,
      "updatedAt" = (statement_timestamp() AT TIME ZONE 'UTC')
    WHERE "AuthLoginAttempt"."windowEndsAt" <= (statement_timestamp() AT TIME ZONE 'UTC')
      OR "AuthLoginAttempt"."count" < ${LOGIN_ATTEMPT_LIMIT}
    RETURNING "username", "count"
  `;
  if (reserved.length === 0) {
    throw new ApiError(429, 'ログインの試行回数が上限に達しました。しばらくしてから再試行してください', undefined, 'AUTH_LOGIN_RATE_LIMITED');
  }
  return Number(reserved[0].count);
}

export class AuthService {
  async login(input: LoginInput): Promise<LoginResult> {
    if (input.username.length > MAX_LOGIN_USERNAME_LENGTH) {
      await bcrypt.compare(input.password, DUMMY_PASSWORD_HASH);
      throw new ApiError(401, 'ユーザー名またはパスワードが違います');
    }
    const attemptCount = await reserveLoginAttempt(input.username);
    const failAttempt = async (error: ApiError): Promise<never> => {
      if (attemptCount === LOGIN_ATTEMPT_LIMIT) await notifyLoginAttemptLimitReached(input.username);
      throw error;
    };
    const user = await prisma.user.findUnique({ where: { username: input.username } });
    if (!user) {
      await bcrypt.compare(input.password, DUMMY_PASSWORD_HASH);
      throw new ApiError(401, 'ユーザー名またはパスワードが違います');
    }
    if (user.status !== 'ACTIVE') {
      throw new ApiError(403, 'アカウントが無効化されています');
    }
    const ok = await bcrypt.compare(input.password, user.passwordHash);
    if (!ok) {
      await failAttempt(new ApiError(401, 'ユーザー名またはパスワードが違います'));
    }

    if (user.mfaEnabled) {
      const totpStep = user.totpSecret ? verifyTotpCodeStep(user.totpSecret, input.totpCode ?? '') : null;
      let totpOk = false;
      if (totpStep !== null) {
        const consumed = await prisma.user.updateMany({
          where: {
            id: user.id,
            OR: [{ totpLastUsedStep: null }, { totpLastUsedStep: { lt: totpStep } }]
          },
          data: { totpLastUsedStep: totpStep }
        });
        totpOk = consumed.count === 1;
      }
      let backupOk = false;
      let remainingCodes = user.mfaBackupCodes;
      if (!totpOk && user.mfaBackupCodes.length > 0) {
        const result = await matchAndConsumeBackupCode(user.mfaBackupCodes, input.backupCode);
        backupOk = result.ok;
        remainingCodes = result.remaining;
        if (backupOk) {
          await prisma.user.update({
            where: { id: user.id },
            data: { mfaBackupCodes: remainingCodes },
          });
        }
      }
      if (!totpOk && !backupOk) {
        await failAttempt(new ApiError(401, 'MFAコードが必要です'));
      }
    }

    const tokens = buildTokenPair(user);
    await prisma.authLoginAttempt.deleteMany({ where: { username: input.username } });
    return {
      ...tokens,
      user: toAuthUserDto(user),
    };
  }

  async refresh(input: RefreshInput): Promise<LoginResult> {
    try {
      const payload = jwt.verify(input.refreshToken, env.JWT_REFRESH_SECRET) as JwtPayload;
      const user = await prisma.user.findUnique({ where: { id: payload.sub } });
      if (!user) {
        throw new ApiError(401, 'ユーザーが見つかりません');
      }
      if (user.status !== 'ACTIVE') {
        throw new ApiError(403, 'アカウントが無効化されています');
      }
      if (user.mfaEnabled === true && payload.mfaEnabled !== true) {
        throw new ApiError(401, 'MFA設定後は再ログインが必要です', undefined, 'MFA_REAUTH_REQUIRED');
      }
      const tokens = buildTokenPair(user);
      return {
        ...tokens,
        user: toAuthUserDto(user),
      };
    } catch (error) {
      if (error instanceof jwt.JsonWebTokenError || error instanceof jwt.TokenExpiredError) {
        throw new ApiError(401, 'リフレッシュトークンが無効です');
      }
      throw error;
    }
  }

  async initiateMfa(userId: string): Promise<MfaInitiateResult> {
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      throw new ApiError(401, 'ユーザーが見つかりません');
    }
    const secret = generateTotpSecret();
    const backupCodes = generateBackupCodes(10);
    const otpauthUrl = `otpauth://totp/RaspberryPiSystem:${encodeURIComponent(user.username)}?secret=${secret}&issuer=RaspberryPiSystem`;
    return { secret, otpauthUrl, backupCodes };
  }

  async activateMfa(userId: string, input: MfaActivateInput): Promise<MfaActivateResult> {
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      throw new ApiError(401, 'ユーザーが見つかりません');
    }
    const passwordOk = await bcrypt.compare(input.password, user.passwordHash);
    if (!passwordOk) {
      throw new ApiError(401, 'パスワードが違います');
    }
    if (user.mfaEnabled) {
      const totpOk = user.totpSecret ? verifyTotpCode(user.totpSecret, input.currentCode ?? '') : false;
      const backupOk = !totpOk && (await matchAndConsumeBackupCode(user.mfaBackupCodes, input.currentBackupCode)).ok;
      if (!totpOk && !backupOk) {
        throw new ApiError(401, '現在のMFAコードが必要です', undefined, 'MFA_REAUTH_REQUIRED');
      }
      // Successful activation replaces all old backup codes in the single update below.
    }
    const ok = verifyTotpCode(input.secret, input.code);
    if (!ok) {
      throw new ApiError(400, 'MFAコードが正しくありません');
    }
    const hashedCodes = await hashBackupCodes(input.backupCodes);
    const updatedUser = await prisma.user.update({
      where: { id: user.id },
      data: {
        mfaEnabled: true,
        totpSecret: input.secret,
        mfaBackupCodes: hashedCodes,
      },
    });
    return {
      ...buildTokenPair(updatedUser),
      user: toAuthUserDto(updatedUser),
      backupCodes: input.backupCodes,
    };
  }

  async disableMfa(userId: string, input: MfaDisableInput): Promise<MfaDisableResult> {
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      throw new ApiError(401, 'ユーザーが見つかりません');
    }
    if (isAdminMfaRequired(user.role)) {
      throw new ApiError(403, '管理者アカウントのMFAは無効化できません', undefined, 'MFA_DISABLE_NOT_ALLOWED');
    }
    const ok = await bcrypt.compare(input.password, user.passwordHash);
    if (!ok) {
      throw new ApiError(401, 'パスワードが違います');
    }
    await prisma.user.update({
      where: { id: user.id },
      data: {
        mfaEnabled: false,
        totpSecret: null,
        mfaBackupCodes: [],
      },
    });
    return { success: true };
  }

  async getRoleAuditLogs(limit: number): Promise<RoleAuditResult> {
    const logs = await prisma.roleAuditLog.findMany({
      orderBy: { createdAt: 'desc' },
      take: limit,
      include: {
        actorUser: { select: { id: true, username: true } },
        targetUser: { select: { id: true, username: true } },
      },
    });
    return { logs };
  }
}
