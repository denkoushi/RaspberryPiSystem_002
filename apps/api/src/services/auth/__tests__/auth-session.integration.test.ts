import { randomUUID } from 'node:crypto';
import type { User } from '@prisma/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../../../lib/prisma.js';
import { createAuthSession } from '../auth-session.service.js';
import { AuthService } from '../auth.service.js';

let user: User | undefined;
beforeEach(async () => {
  user = undefined;
  user = await prisma.user.create({ data: { username: `session-${randomUUID()}`, passwordHash: 'initial-hash' } });
});
afterEach(async () => {
  if (user) await prisma.user.delete({ where: { id: user.id } });
});
describe('AuthSession credential-change migration trigger', () => {
  it.each([
    { passwordHash: 'changed-hash' },
    { status: 'DISABLED' as const }
  ])('atomically revokes all sessions when credentials change: %j', async (data) => {
    await createAuthSession(user!);
    await createAuthSession(user!);
    await prisma.user.update({ where: { id: user!.id }, data });
    expect(await prisma.authSession.count({ where: { userId: user!.id, revokedAt: null } })).toBe(0);
    expect(await prisma.authSession.count({ where: { userId: user!.id } })).toBe(2);
  });
  it('preserves sessions for unrelated updates and unchanged credential values', async () => {
    await createAuthSession(user!);
    await prisma.user.update({ where: { id: user!.id }, data: { username: `renamed-${randomUUID()}`, passwordHash: user!.passwordHash, status: 'ACTIVE' } });
    expect(await prisma.authSession.count({ where: { userId: user!.id, revokedAt: null } })).toBe(1);
  });
  it('accepts only one simultaneous refresh and revokes the session on reuse', async () => {
    const tokens = await createAuthSession(user!);
    const service = new AuthService();
    const results = await Promise.allSettled([service.refresh({ refreshToken: tokens.refreshToken }), service.refresh({ refreshToken: tokens.refreshToken })]);
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.find((result) => result.status === 'rejected')).toMatchObject({ reason: { statusCode: 401 } });
    expect(await prisma.authSession.count({ where: { userId: user!.id, revokedAt: null } })).toBe(0);
  });
});
