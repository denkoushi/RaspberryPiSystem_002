import type { User, UserRole } from '@prisma/client';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { env } from '../../config/env.js';
import { signAccessToken, signRefreshToken, type JwtPayload } from '../../lib/auth.js';
import { ApiError } from '../../lib/errors.js';
import {
  generateBackupCodes,
  generateTotpSecret,
  hashBackupCodes,
  matchAndConsumeBackupCode,
  verifyTotpCode,
} from '../../lib/mfa.js';
import { prisma } from '../../lib/prisma.js';

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
  secret: string;
  code: string;
  backupCodes: string[];
};

export type MfaActivateResult = {
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
  };
}

function buildTokenPair(user: User): Pick<LoginResult, 'accessToken' | 'refreshToken'> {
  return {
    accessToken: signAccessToken(user),
    refreshToken: signRefreshToken(user),
  };
}

export class AuthService {
  async login(input: LoginInput): Promise<LoginResult> {
    const user = await prisma.user.findUnique({ where: { username: input.username } });
    if (!user) {
      throw new ApiError(401, 'ユーザー名またはパスワードが違います');
    }
    if (user.status !== 'ACTIVE') {
      throw new ApiError(403, 'アカウントが無効化されています');
    }
    const ok = await bcrypt.compare(input.password, user.passwordHash);
    if (!ok) {
      throw new ApiError(401, 'ユーザー名またはパスワードが違います');
    }

    if (user.mfaEnabled) {
      const totpOk = user.totpSecret ? verifyTotpCode(user.totpSecret, input.totpCode ?? '') : false;
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
        throw new ApiError(401, 'MFAコードが必要です');
      }
    }

    const tokens = buildTokenPair(user);
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
    const ok = verifyTotpCode(input.secret, input.code);
    if (!ok) {
      throw new ApiError(400, 'MFAコードが正しくありません');
    }
    const hashedCodes = await hashBackupCodes(input.backupCodes);
    await prisma.user.update({
      where: { id: user.id },
      data: {
        mfaEnabled: true,
        totpSecret: input.secret,
        mfaBackupCodes: hashedCodes,
      },
    });
    return { backupCodes: input.backupCodes };
  }

  async disableMfa(userId: string, input: MfaDisableInput): Promise<MfaDisableResult> {
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      throw new ApiError(401, 'ユーザーが見つかりません');
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
