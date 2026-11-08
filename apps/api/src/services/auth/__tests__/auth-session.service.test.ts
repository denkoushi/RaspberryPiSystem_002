import type { AuthSession, User } from '@prisma/client';
import type { FastifyRequest, FastifyReply } from 'fastify';
import jwt from 'jsonwebtoken';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ sessions: new Map<string, Record<string, unknown>>(), user: { id: 'u1', username: 'alice', role: 'MANAGER', status: 'ACTIVE', mfaEnabled: false } }));
vi.mock('../../../config/env.js', () => ({ env: { JWT_ACCESS_SECRET: 'access', JWT_REFRESH_SECRET: 'refresh', TOKEN_EXPIRES_IN: '15m', REFRESH_TOKEN_EXPIRES_IN: '7d', ADMIN_MFA_REQUIRED: false } }));
vi.mock('../../../lib/logger.js', () => ({ logger: { warn: vi.fn() } }));
vi.mock('../../../lib/prisma.js', () => ({ prisma: {
  user: { findUnique: vi.fn(async () => state.user) },
  authSession: {
    create: vi.fn(async ({ data }) => { const session = { id: 's1', createdAt: new Date(), revokedAt: null, ...data }; state.sessions.set('s1', session); return session; }),
    findUnique: vi.fn(async ({ where }) => state.sessions.get(where.id) ?? null),
    findUniqueOrThrow: vi.fn(async ({ where }) => state.sessions.get(where.id)),
    updateMany: vi.fn(async ({ where, data }) => {
      let count = 0;
      for (const row of state.sessions.values()) {
        if (where.id && typeof where.id === 'string' && row.id !== where.id) continue;
        if (where.id?.not && row.id === where.id.not) continue;
        if (where.userId && row.userId !== where.userId) continue;
        if (where.revokedAt === null && row.revokedAt !== null) continue;
        if (where.refreshTokenId && row.refreshTokenId !== where.refreshTokenId) continue;
        if (where.expiresAt && (row.expiresAt as Date) <= where.expiresAt.gt) continue;
        Object.assign(row, data); count++;
      }
      return { count };
    })
  },
  productionScheduleAccessPasswordConfig: { findUnique: vi.fn(async () => null) },
  $executeRaw: vi.fn(async () => 0)
} }));
import { createAuthSession, revokeUserSessions, rotateAuthSession, deleteExpiredAuthSessions } from '../auth-session.service.js';
import { authenticate, requireKioskAccessToken, signKioskAccessToken, signAccessToken } from '../../../lib/auth.js';
import { AuthService } from '../auth.service.js';
import { prisma } from '../../../lib/prisma.js';

const service = new AuthService();
const user = state.user as User;
function authenticateToken(token: string) {
  return authenticate({ headers: { authorization: `Bearer ${token}` }, routeOptions: {}, method: 'GET' } as FastifyRequest, { code: vi.fn() } as unknown as FastifyReply);
}
beforeEach(() => { state.sessions.clear(); vi.useFakeTimers(); vi.setSystemTime(new Date('2026-11-08T20:00:00Z')); });
afterEach(() => vi.useRealTimers());

describe('server-side auth sessions', () => {
  it('refreshes twice, rotates identifiers and never extends the seven-day absolute expiry', async () => {
    const first = await createAuthSession(user);
    const firstClaims = jwt.decode(first.refreshToken) as jwt.JwtPayload;
    expect(firstClaims.exp).toBe(Math.floor(Date.now() / 1000) + 7 * 86400);
    vi.advanceTimersByTime(6 * 86400000);
    const second = await service.refresh({ refreshToken: first.refreshToken });
    const third = await service.refresh({ refreshToken: second.refreshToken });
    const claims = jwt.decode(third.refreshToken) as jwt.JwtPayload;
    expect(claims.exp).toBe(firstClaims.exp);
    expect(claims.tokenId).not.toBe(firstClaims.tokenId);
    await expect(authenticateToken(third.accessToken)).resolves.toBeUndefined();
    vi.advanceTimersByTime(86400000);
    await expect(service.refresh({ refreshToken: third.refreshToken })).rejects.toMatchObject({ statusCode: 401 });
    await expect(rotateAuthSession(user, 's1', claims.tokenId)).rejects.toMatchObject({ statusCode: 401 });
  });

  it('revokes the whole session after reuse of a rotated refresh token', async () => {
    const first = await createAuthSession(user);
    const next = await service.refresh({ refreshToken: first.refreshToken });
    await expect(service.refresh({ refreshToken: first.refreshToken })).rejects.toMatchObject({ statusCode: 401 });
    expect(state.sessions.get('s1')?.revokedAt).toBeInstanceOf(Date);
    await expect(authenticateToken(next.accessToken)).rejects.toMatchObject({ statusCode: 401, code: 'AUTH_TOKEN_INVALID' });
    await expect(service.refresh({ refreshToken: next.refreshToken })).rejects.toMatchObject({ statusCode: 401 });
  });

  it('rejects access and refresh after logout and leaves kiosk tokens usable', async () => {
    const tokens = await createAuthSession(user);
    await prisma.authSession.updateMany({ where: { id: 's1' }, data: { revokedAt: new Date() } });
    await expect(authenticateToken(tokens.accessToken)).rejects.toMatchObject({ statusCode: 401 });
    await expect(service.refresh({ refreshToken: tokens.refreshToken })).rejects.toMatchObject({ statusCode: 401 });
    const kiosk = signKioskAccessToken('due-management', 'device-1');
    expect(() => requireKioskAccessToken(kiosk, 'due-management', 'device-1')).not.toThrow();
  });

  it('rejects legacy tokens, refresh tokens used as access and mismatched session owners', async () => {
    const tokens = await createAuthSession(user);
    await expect(authenticateToken(signAccessToken(user))).rejects.toMatchObject({ statusCode: 401 });
    await expect(authenticateToken(tokens.refreshToken)).rejects.toMatchObject({ statusCode: 401 });
    state.sessions.get('s1')!.userId = 'other';
    await expect(authenticateToken(tokens.accessToken)).rejects.toMatchObject({ statusCode: 401 });
  });

  it('revokes other sessions while retaining the current session when requested', async () => {
    await createAuthSession(user);
    state.sessions.set('s2', { ...state.sessions.get('s1'), id: 's2' } as unknown as AuthSession & Record<string, unknown>);
    await revokeUserSessions('u1', 's1');
    expect(state.sessions.get('s1')!.revokedAt).toBeNull();
    expect(state.sessions.get('s2')!.revokedAt).toBeInstanceOf(Date);
  });

  it('bounds cleanup work and retains recent revocations for replay detection', async () => {
    await deleteExpiredAuthSessions();
    const sql = vi.mocked(prisma.$executeRaw).mock.calls.at(-1)![0] as TemplateStringsArray;
    expect(sql.join('')).toContain('LIMIT 100 FOR UPDATE SKIP LOCKED');
    expect(sql.join('')).toContain("INTERVAL '7 days'");
  });
});
