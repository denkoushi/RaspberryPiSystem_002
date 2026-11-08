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
  sessionCreate: vi.fn(),
  sessionUpdate: vi.fn(),
  sessionFind: vi.fn(),
  findUnique: vi.fn(),
  update: vi.fn(),
  updateMany: vi.fn(),
  queryRaw: vi.fn(),
  executeRaw: vi.fn(),
  deleteMany: vi.fn(),
  findMany: vi.fn(),
  notifyLimit: vi.fn()
}));

vi.mock('../../../config/env.js', () => ({ env: mocks.env }));
vi.mock('../../../lib/logger.js', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));
vi.mock('../login-limit-alert.js', () => ({ LOGIN_ATTEMPT_LIMIT: 10, notifyLoginAttemptLimitReached: mocks.notifyLimit }));
vi.mock('../../../lib/prisma.js', () => ({
  prisma: {
    authSession: { create: mocks.sessionCreate, updateMany: mocks.sessionUpdate, findUniqueOrThrow: mocks.sessionFind },
    user: { findUnique: mocks.findUnique, update: mocks.update, updateMany: mocks.updateMany },
    $transaction: vi.fn(),
    $queryRaw: mocks.queryRaw,
    $executeRaw: mocks.executeRaw,
    authLoginAttempt: { deleteMany: mocks.deleteMany },
    roleAuditLog: { findMany: mocks.findMany }
  }
}));

import { ApiError } from '../../../lib/errors.js';
import { verifyTotpCodeStep } from '../../../lib/mfa.js';
import { AuthService } from '../auth.service.js';
import { prisma } from '../../../lib/prisma.js';

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
  vi.mocked(prisma.$transaction).mockImplementation(async (callback) => (callback as (tx: typeof prisma) => Promise<unknown>)(prisma));
  mocks.sessionCreate.mockReset().mockImplementation(async ({ data }) => ({ id: 'session-1', ...data }));
  mocks.sessionUpdate.mockReset().mockResolvedValue({ count: 1 });
  mocks.sessionFind.mockReset().mockResolvedValue({ id: 'session-1', refreshTokenId: 'old-refresh', expiresAt: new Date(Date.now() + 86400000) });
  mocks.env.ADMIN_MFA_REQUIRED = false;
  mocks.findUnique.mockReset();
  mocks.update.mockReset();
  mocks.updateMany.mockReset().mockResolvedValue({ count: 1 });
  mocks.queryRaw.mockReset().mockResolvedValue([{ username: 'alice', count: 1 }]);
  mocks.notifyLimit.mockReset().mockResolvedValue(undefined);
  mocks.executeRaw.mockReset().mockResolvedValue(0);
  mocks.deleteMany.mockReset().mockResolvedValue({ count: 1 });
  mocks.findMany.mockReset();
});

describe('AuthService.login', () => {
  it('returns a token pair and user DTO for valid credentials', async () => {
    mocks.findUnique.mockResolvedValue(makeUser({ role: 'MANAGER' }));
    const result = await service.login({ username: 'alice', password: PASSWORD });

    expect(mocks.findUnique).toHaveBeenCalledWith({ where: { username: 'alice' } });
    expect(mocks.deleteMany).toHaveBeenCalledWith({ where: { username: 'alice' } });
    expect(result.user).toEqual({
      id: 'user-1',
      username: 'alice',
      role: 'MANAGER',
      mfaEnabled: false,
      mfaSetupRequired: false,
      mfaRequired: false
    });
    const access = jwt.verify(result.accessToken, 'svc-access-secret') as jwt.JwtPayload;
    expect(access).toMatchObject({ sub: 'user-1', role: 'MANAGER', mfaEnabled: false, sessionId: 'session-1' });
    expect(mocks.sessionCreate).toHaveBeenCalledExactlyOnceWith({ data: { userId: 'user-1', expiresAt: expect.any(Date), refreshTokenId: expect.any(String) } });
    const refresh = jwt.verify(result.refreshToken, 'svc-refresh-secret') as jwt.JwtPayload;
    expect(refresh).toMatchObject({ sub: 'user-1', sessionId: access.sessionId, tokenId: expect.any(String) });
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

  it('compares a fixed dummy hash once for an unknown username', async () => {
    const compare = vi.spyOn(bcrypt, 'compare');
    try {
      mocks.findUnique.mockResolvedValue(null);
      await expect(service.login({ username: 'missing', password: PASSWORD })).rejects.toMatchObject({ statusCode: 401 });
      expect(compare).toHaveBeenCalledTimes(1);
      const hash = compare.mock.calls[0][1];
      expect(bcrypt.getRounds(hash)).toBe(10);
      compare.mockClear();
      await expect(service.login({ username: 'other-missing', password: PASSWORD })).rejects.toMatchObject({ statusCode: 401 });
      expect(compare.mock.calls[0][1]).toBe(hash);
      expect(mocks.deleteMany).not.toHaveBeenCalled();
    } finally {
      compare.mockRestore();
    }
  });

  it('rejects an over-long username with the same 401 without recording an attempt', async () => {
    const compare = vi.spyOn(bcrypt, 'compare');
    try {
      await expect(service.login({ username: 'u'.repeat(129), password: PASSWORD })).rejects.toMatchObject({
        statusCode: 401, message: 'ユーザー名またはパスワードが違います'
      });
      expect(compare).toHaveBeenCalledTimes(1);
      expect(mocks.executeRaw).not.toHaveBeenCalled();
      expect(mocks.queryRaw).not.toHaveBeenCalled();
      expect(mocks.findUnique).not.toHaveBeenCalled();
    } finally {
      compare.mockRestore();
    }
  });

  it('notifies once when the attempt that reaches the limit fails', async () => {
    mocks.findUnique.mockResolvedValue(makeUser());
    mocks.queryRaw.mockResolvedValue([{ username: 'alice', count: 10 }]);
    const error = await captureError(service.login({ username: 'alice', password: 'wrong-password' }));
    expect(error.statusCode).toBe(401);
    expect(mocks.notifyLimit).toHaveBeenCalledWith('alice');
  });

  it('does not notify before the limit or when the limiting attempt succeeds', async () => {
    mocks.findUnique.mockResolvedValue(makeUser());
    mocks.queryRaw.mockResolvedValue([{ username: 'alice', count: 9 }]);
    await captureError(service.login({ username: 'alice', password: 'wrong-password' }));
    mocks.queryRaw.mockResolvedValue([{ username: 'alice', count: 10 }]);
    await service.login({ username: 'alice', password: PASSWORD });
    expect(mocks.notifyLimit).not.toHaveBeenCalled();
  });

  it('continues to reserve the attempt when deleting expired attempts fails', async () => {
    mocks.executeRaw.mockRejectedValue(new Error('lock timeout'));
    await service.login({ username: 'alice', password: 'wrong-password' }).catch(() => undefined);
    expect(mocks.queryRaw).toHaveBeenCalledTimes(1);
    expect(mocks.findUnique).toHaveBeenCalled();
  });

  it('returns 429 before user lookup and password comparison when reservation is refused', async () => {
    mocks.queryRaw.mockResolvedValue([]);
    const compare = vi.spyOn(bcrypt, 'compare');
    try {
      await expect(service.login({ username: 'alice', password: PASSWORD })).rejects.toMatchObject({
        statusCode: 429, code: 'AUTH_LOGIN_RATE_LIMITED',
        message: 'ログインの試行回数が上限に達しました。しばらくしてから再試行してください'
      });
      expect(mocks.findUnique).not.toHaveBeenCalled();
      expect(compare).not.toHaveBeenCalled();
    } finally {
      compare.mockRestore();
    }
  });

  it('returns the password-mismatch response for inactive accounts after password comparison', async () => {
    mocks.findUnique.mockResolvedValue(makeUser({ status: 'DISABLED' as User['status'] }));
    const error = await captureError(service.login({ username: 'alice', password: 'whatever' }));
    expect(error.statusCode).toBe(401);
    expect(error.message).toBe('ユーザー名またはパスワードが違います');
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

    it('rejects a TOTP step when its conditional update does not consume it', async () => {
      mocks.findUnique.mockResolvedValue(makeUser({ mfaEnabled: true, totpSecret: TOTP_SECRET }));
      mocks.updateMany.mockResolvedValue({ count: 0 });
      await expect(service.login({ username: 'alice', password: PASSWORD, totpCode: authenticator.generate(TOTP_SECRET) }))
        .rejects.toMatchObject({ statusCode: 401, message: 'MFAコードが必要です' });
      expect(mocks.deleteMany).not.toHaveBeenCalled();
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
    jwt.sign({ tokenType: 'refresh', sessionId: 'session-1', tokenId: 'refresh-1', ...claims }, secret, options);

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
    expect(error.statusCode).toBe(401);
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

describe('TOTP matched steps', () => {
  it('returns the actual current, earlier and later step within the configured window', () => {
    const originalOptions = authenticator.options;
    const epoch = 1_800_000_000_000;
    try {
      authenticator.options = { epoch, step: 30, window: 1 };
      for (const offset of [-1, 0, 1]) {
        const generator = authenticator.clone();
        generator.options = { epoch: epoch + offset * 30_000 };
        expect(verifyTotpCodeStep(TOTP_SECRET, generator.generate(TOTP_SECRET))).toBe(epoch / 30_000 + offset);
      }
      expect(verifyTotpCodeStep(TOTP_SECRET, 'invalid')).toBeNull();
      expect(verifyTotpCodeStep(TOTP_SECRET, '')).toBeNull();
      expect(verifyTotpCodeStep('', '123456')).toBeNull();
    } finally {
      authenticator.resetOptions();
      authenticator.options = originalOptions;
    }
  });
});

describe('session revocation on MFA changes', () => {
  it('revokes other sessions and rotates the current session without extending its expiry on MFA activation', async () => {
    const user = makeUser({ role: 'MANAGER' });
    mocks.findUnique.mockResolvedValue(user);
    mocks.update.mockResolvedValue({ ...user, mfaEnabled: true });
    const result = await service.activateMfa(user.id, {
      password: PASSWORD, secret: TOTP_SECRET, code: authenticator.generate(TOTP_SECRET), backupCodes: ['backup-code']
    }, 'session-1');
    expect(mocks.sessionUpdate).toHaveBeenCalledWith({ where: { userId: user.id, revokedAt: null, id: { not: 'session-1' } }, data: { revokedAt: expect.any(Date) } });
    expect(mocks.sessionCreate).not.toHaveBeenCalled();
    const existingSession = await mocks.sessionFind.mock.results[0].value;
    expect((jwt.decode(result.refreshToken) as jwt.JwtPayload).exp).toBe(Math.floor(existingSession.expiresAt.getTime() / 1000));
    expect(result.backupCodes).toEqual(['backup-code']);
    expect(jwt.decode(result.accessToken)).toMatchObject({ sessionId: 'session-1', mfaEnabled: true });
  });
  it('retains only the current session on MFA disable', async () => {
    mocks.findUnique.mockResolvedValue(makeUser({ mfaEnabled: true }));
    await service.disableMfa('user-1', { password: PASSWORD }, 'current-session');
    expect(mocks.sessionUpdate).toHaveBeenCalledWith({ where: { userId: 'user-1', revokedAt: null, id: { not: 'current-session' } }, data: { revokedAt: expect.any(Date) } });
  });
  it('counts disabled accounts exactly like wrong passwords, including notification', async () => {
    mocks.findUnique.mockResolvedValue(makeUser({ status: 'DISABLED' }));
    mocks.queryRaw.mockResolvedValue([{ username: 'alice', count: 10 }]);
    const compare = vi.spyOn(bcrypt, 'compare');
    try {
      await expect(service.login({ username: 'alice', password: PASSWORD })).rejects.toMatchObject({ statusCode: 401, message: 'ユーザー名またはパスワードが違います' });
      expect(compare).toHaveBeenCalledWith(PASSWORD, PASSWORD_HASH);
      expect(mocks.notifyLimit).toHaveBeenCalledWith('alice');
      expect(mocks.sessionCreate).not.toHaveBeenCalled();
      expect(mocks.deleteMany).not.toHaveBeenCalled();
    } finally { compare.mockRestore(); }
  });
});
