import type { User } from '@prisma/client';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { authenticator } from 'otplib';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  env: {
    ADMIN_MFA_REQUIRED: false as boolean,
    JWT_ACCESS_SECRET: 'svc-access-secret',
    JWT_REFRESH_SECRET: 'svc-refresh-secret',
    TOKEN_EXPIRES_IN: '15m',
    REFRESH_TOKEN_EXPIRES_IN: '7d'
  },
  findUnique: vi.fn(),
  update: vi.fn(),
  findMany: vi.fn()
}));

vi.mock('../../../config/env.js', () => ({ env: mocks.env }));
vi.mock('../../../lib/prisma.js', () => ({
  prisma: {
    user: { findUnique: mocks.findUnique, update: mocks.update },
    roleAuditLog: { findMany: mocks.findMany }
  }
}));

import { ApiError } from '../../../lib/errors.js';
import { AuthService } from '../auth.service.js';

const PASSWORD = 'correct-horse';
const PASSWORD_HASH = bcrypt.hashSync(PASSWORD, 4);
const TOTP_SECRET = authenticator.generateSecret();

function makeUser(overrides: Partial<User> = {}): User {
  return {
    id: 'user-1',
    username: 'alice',
    passwordHash: PASSWORD_HASH,
    role: 'VIEWER',
    status: 'ACTIVE',
    mfaEnabled: false,
    totpSecret: null,
    mfaBackupCodes: [],
    ...overrides
  } as User;
}

async function captureError(promise: Promise<unknown>): Promise<ApiError> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof ApiError) return error;
    throw error;
  }
  throw new Error('expected ApiError');
}

const service = new AuthService();

beforeEach(() => {
  mocks.env.ADMIN_MFA_REQUIRED = false;
  mocks.findUnique.mockReset();
  mocks.update.mockReset();
  mocks.findMany.mockReset();
});

describe('AuthService.login', () => {
  it('returns a token pair and user DTO for valid credentials', async () => {
    mocks.findUnique.mockResolvedValue(makeUser({ role: 'MANAGER' }));
    const result = await service.login({ username: 'alice', password: PASSWORD });

    expect(mocks.findUnique).toHaveBeenCalledWith({ where: { username: 'alice' } });
    expect(result.user).toEqual({
      id: 'user-1',
      username: 'alice',
      role: 'MANAGER',
      mfaEnabled: false,
      mfaSetupRequired: false,
      mfaRequired: false
    });
    const access = jwt.verify(result.accessToken, 'svc-access-secret') as jwt.JwtPayload;
    expect(access).toMatchObject({ sub: 'user-1', role: 'MANAGER', mfaEnabled: false });
    const refresh = jwt.verify(result.refreshToken, 'svc-refresh-secret') as jwt.JwtPayload;
    expect(refresh.sub).toBe('user-1');
  });

  it('uses the same 401 message for unknown user and wrong password (no user enumeration)', async () => {
    mocks.findUnique.mockResolvedValue(null);
    const unknown = await captureError(service.login({ username: 'nobody', password: PASSWORD }));

    mocks.findUnique.mockResolvedValue(makeUser());
    const wrong = await captureError(service.login({ username: 'alice', password: 'wrong' }));

    expect(unknown.statusCode).toBe(401);
    expect(wrong.statusCode).toBe(401);
    expect(unknown.message).toBe(wrong.message);
  });

  it('rejects an inactive account with 403 before checking the password', async () => {
    mocks.findUnique.mockResolvedValue(makeUser({ status: 'DISABLED' as User['status'] }));
    const error = await captureError(service.login({ username: 'alice', password: 'whatever' }));
    expect(error.statusCode).toBe(403);
    expect(error.message).toBe('アカウントが無効化されています');
  });

  it('flags ADMIN without MFA as setup-required when enforcement is on', async () => {
    mocks.env.ADMIN_MFA_REQUIRED = true;
    mocks.findUnique.mockResolvedValue(makeUser({ role: 'ADMIN' }));
    const result = await service.login({ username: 'alice', password: PASSWORD });
    expect(result.user.mfaRequired).toBe(true);
    expect(result.user.mfaSetupRequired).toBe(true);
  });

  describe('with MFA enabled', () => {
    it('requires a TOTP or backup code', async () => {
      mocks.findUnique.mockResolvedValue(makeUser({ mfaEnabled: true, totpSecret: TOTP_SECRET }));
      const error = await captureError(service.login({ username: 'alice', password: PASSWORD }));
      expect(error.statusCode).toBe(401);
      expect(error.message).toBe('MFAコードが必要です');
    });

    it('rejects a wrong TOTP code', async () => {
      mocks.findUnique.mockResolvedValue(makeUser({ mfaEnabled: true, totpSecret: TOTP_SECRET }));
      const current = authenticator.generate(TOTP_SECRET);
      const wrong = current === '000000' ? '111111' : '000000';
      const error = await captureError(service.login({ username: 'alice', password: PASSWORD, totpCode: wrong }));
      expect(error.statusCode).toBe(401);
    });

    it('accepts a valid TOTP code without touching backup codes', async () => {
      const backup = [bcrypt.hashSync('backup-a', 4)];
      mocks.findUnique.mockResolvedValue(makeUser({ mfaEnabled: true, totpSecret: TOTP_SECRET, mfaBackupCodes: backup }));
      const result = await service.login({
        username: 'alice',
        password: PASSWORD,
        totpCode: authenticator.generate(TOTP_SECRET)
      });
      expect(result.user.mfaEnabled).toBe(true);
      expect(mocks.update).not.toHaveBeenCalled();
      expect((jwt.decode(result.accessToken) as jwt.JwtPayload).mfaEnabled).toBe(true);
    });

    it('consumes a matching backup code exactly once', async () => {
      const hashA = bcrypt.hashSync('backup-a', 4);
      const hashB = bcrypt.hashSync('backup-b', 4);
      mocks.findUnique.mockResolvedValue(makeUser({ mfaEnabled: true, totpSecret: TOTP_SECRET, mfaBackupCodes: [hashA, hashB] }));

      await service.login({ username: 'alice', password: PASSWORD, backupCode: 'backup-b' });
      expect(mocks.update).toHaveBeenCalledWith({ where: { id: 'user-1' }, data: { mfaBackupCodes: [hashA] } });
    });

    it('rejects an unknown backup code without updating the user', async () => {
      mocks.findUnique.mockResolvedValue(
        makeUser({ mfaEnabled: true, totpSecret: TOTP_SECRET, mfaBackupCodes: [bcrypt.hashSync('backup-a', 4)] })
      );
      const error = await captureError(service.login({ username: 'alice', password: PASSWORD, backupCode: 'backup-x' }));
      expect(error.statusCode).toBe(401);
      expect(mocks.update).not.toHaveBeenCalled();
    });

    it('rejects login when MFA is enabled but no secret and no backup codes exist', async () => {
      mocks.findUnique.mockResolvedValue(makeUser({ mfaEnabled: true, totpSecret: null, mfaBackupCodes: [] }));
      const error = await captureError(service.login({ username: 'alice', password: PASSWORD, totpCode: '123456' }));
      expect(error.statusCode).toBe(401);
    });

    it('does not check MFA when the password is wrong', async () => {
      mocks.findUnique.mockResolvedValue(makeUser({ mfaEnabled: true, totpSecret: TOTP_SECRET }));
      const error = await captureError(
        service.login({ username: 'alice', password: 'wrong', totpCode: authenticator.generate(TOTP_SECRET) })
      );
      expect(error.message).toBe('ユーザー名またはパスワードが違います');
    });
  });
});

describe('AuthService.refresh', () => {
  const refreshFor = (claims: Record<string, unknown>, secret = 'svc-refresh-secret', options: jwt.SignOptions = { expiresIn: '7d' }) =>
    jwt.sign(claims, secret, options);

  it('issues a new pair from a valid refresh token using current DB state', async () => {
    // Role changed in DB since the token was issued: the new tokens must carry the DB role.
    mocks.findUnique.mockResolvedValue(makeUser({ role: 'VIEWER' }));
    const result = await service.refresh({ refreshToken: refreshFor({ sub: 'user-1', username: 'alice', role: 'ADMIN' }) });
    expect(mocks.findUnique).toHaveBeenCalledWith({ where: { id: 'user-1' } });
    expect(result.user.role).toBe('VIEWER');
    expect((jwt.verify(result.accessToken, 'svc-access-secret') as jwt.JwtPayload).role).toBe('VIEWER');
  });

  it.each([
    ['signed with the access secret', () => refreshFor({ sub: 'user-1' }, 'svc-access-secret')],
    ['signed with an unknown secret', () => refreshFor({ sub: 'user-1' }, 'nope')],
    ['malformed', () => 'not-a-jwt'],
    ['expired', () => jwt.sign({ sub: 'user-1', exp: Math.floor(Date.now() / 1000) - 60 }, 'svc-refresh-secret')]
  ])('rejects a refresh token that is %s with 401', async (_label, makeToken) => {
    const error = await captureError(service.refresh({ refreshToken: makeToken() }));
    expect(error.statusCode).toBe(401);
    expect(error.message).toBe('リフレッシュトークンが無効です');
    expect(mocks.findUnique).not.toHaveBeenCalled();
  });

  it('rejects when the user no longer exists', async () => {
    mocks.findUnique.mockResolvedValue(null);
    const error = await captureError(service.refresh({ refreshToken: refreshFor({ sub: 'gone' }) }));
    expect(error.statusCode).toBe(401);
    expect(error.message).toBe('ユーザーが見つかりません');
  });

  it('rejects when the user has been disabled', async () => {
    mocks.findUnique.mockResolvedValue(makeUser({ status: 'DISABLED' as User['status'] }));
    const error = await captureError(service.refresh({ refreshToken: refreshFor({ sub: 'user-1' }) }));
    expect(error.statusCode).toBe(403);
  });

  it('forces re-login when MFA was enabled after the refresh token was issued', async () => {
    mocks.findUnique.mockResolvedValue(makeUser({ mfaEnabled: true, totpSecret: TOTP_SECRET }));
    const stale = refreshFor({ sub: 'user-1', mfaEnabled: false });
    const error = await captureError(service.refresh({ refreshToken: stale }));
    expect(error.statusCode).toBe(401);
    expect(error.code).toBe('MFA_REAUTH_REQUIRED');

    const fresh = refreshFor({ sub: 'user-1', mfaEnabled: true });
    await expect(service.refresh({ refreshToken: fresh })).resolves.toMatchObject({ user: { mfaEnabled: true } });
  });
});

describe('AuthService.initiateMfa', () => {
  it('returns a fresh secret, 10 backup codes and an otpauth URL with the encoded username', async () => {
    mocks.findUnique.mockResolvedValue(makeUser({ username: 'a b@c' }));
    const result = await service.initiateMfa('user-1');
    expect(result.backupCodes).toHaveLength(10);
    expect(new Set(result.backupCodes).size).toBe(10);
    for (const code of result.backupCodes) expect(code).toMatch(/^[0-9a-f]{10}$/);
    expect(result.otpauthUrl).toBe(
      `otpauth://totp/RaspberryPiSystem:a%20b%40c?secret=${result.secret}&issuer=RaspberryPiSystem`
    );
    // Nothing is persisted until activation.
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it('rejects an unknown user', async () => {
    mocks.findUnique.mockResolvedValue(null);
    expect((await captureError(service.initiateMfa('gone'))).statusCode).toBe(401);
  });
});

describe('AuthService.disableMfa', () => {
  it('clears MFA state after password confirmation', async () => {
    mocks.findUnique.mockResolvedValue(makeUser({ mfaEnabled: true, totpSecret: TOTP_SECRET, mfaBackupCodes: ['h'] }));
    await expect(service.disableMfa('user-1', { password: PASSWORD })).resolves.toEqual({ success: true });
    expect(mocks.update).toHaveBeenCalledWith({
      where: { id: 'user-1' },
      data: { mfaEnabled: false, totpSecret: null, mfaBackupCodes: [] }
    });
  });

  it('rejects a wrong password without changing anything', async () => {
    mocks.findUnique.mockResolvedValue(makeUser({ mfaEnabled: true }));
    const error = await captureError(service.disableMfa('user-1', { password: 'wrong' }));
    expect(error.statusCode).toBe(401);
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it('forbids ADMIN/MANAGER from disabling MFA while enforcement is on, even with the right password', async () => {
    mocks.env.ADMIN_MFA_REQUIRED = true;
    for (const role of ['ADMIN', 'MANAGER'] as const) {
      mocks.findUnique.mockResolvedValue(makeUser({ role, mfaEnabled: true }));
      const error = await captureError(service.disableMfa('user-1', { password: PASSWORD }));
      expect(error.statusCode).toBe(403);
      expect(error.code).toBe('MFA_DISABLE_NOT_ALLOWED');
    }
    expect(mocks.update).not.toHaveBeenCalled();

    mocks.findUnique.mockResolvedValue(makeUser({ role: 'VIEWER', mfaEnabled: true }));
    await expect(service.disableMfa('user-1', { password: PASSWORD })).resolves.toEqual({ success: true });
  });
});

describe('AuthService.getRoleAuditLogs', () => {
  it('queries newest first with the requested limit and actor/target usernames', async () => {
    mocks.findMany.mockResolvedValue([]);
    await expect(service.getRoleAuditLogs(25)).resolves.toEqual({ logs: [] });
    expect(mocks.findMany).toHaveBeenCalledWith({
      orderBy: { createdAt: 'desc' },
      take: 25,
      include: {
        actorUser: { select: { id: true, username: true } },
        targetUser: { select: { id: true, username: true } }
      }
    });
  });
});
