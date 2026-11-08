import { randomUUID } from 'node:crypto';
import type { AuthSession, Prisma, PrismaClient, User } from '@prisma/client';
import { prisma } from '../../lib/prisma.js';
import { ApiError } from '../../lib/errors.js';
import { signAccessToken, signRefreshToken } from '../../lib/auth.js';
import { logger } from '../../lib/logger.js';

export async function deleteExpiredAuthSessions(): Promise<void> {
  try {
    await prisma.$executeRaw`
      DELETE FROM "AuthSession" WHERE "id" IN (
        SELECT "id" FROM "AuthSession"
        WHERE "expiresAt" <= (statement_timestamp() AT TIME ZONE 'UTC')
          OR "revokedAt" <= (statement_timestamp() AT TIME ZONE 'UTC') - INTERVAL '7 days'
        ORDER BY "expiresAt" LIMIT 100 FOR UPDATE SKIP LOCKED
      )
    `;
  } catch (error) {
    logger.warn({ err: error }, 'Failed to delete expired auth sessions');
  }
}

export function sessionTokens(user: User, session: AuthSession) {
  return {
    accessToken: signAccessToken(user, session.id),
    refreshToken: signRefreshToken(user, session.id, session.refreshTokenId, session.expiresAt)
  };
}

export async function createAuthSession(user: User) {
  const session = await prisma.authSession.create({ data: {
    userId: user.id, expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), refreshTokenId: randomUUID()
  } });
  return sessionTokens(user, session);
}

export async function revokeUserSessions(userId: string, exceptSessionId?: string, db: Pick<PrismaClient, 'authSession'> = prisma): Promise<void> {
  await db.authSession.updateMany({
    where: { userId, revokedAt: null, ...(exceptSessionId ? { id: { not: exceptSessionId } } : {}) },
    data: { revokedAt: new Date() }
  });
}

export async function rotateAuthSession(user: User, sessionId: string | undefined, refreshTokenId: string | undefined) {
  if (!sessionId || !refreshTokenId) throw new ApiError(401, 'リフレッシュトークンが無効です');
  const now = new Date();
  const nextId = randomUUID();
  const changed = await prisma.authSession.updateMany({
    where: { id: sessionId, userId: user.id, refreshTokenId, revokedAt: null, expiresAt: { gt: now } },
    data: { refreshTokenId: nextId }
  });
  if (changed.count !== 1) {
    await prisma.authSession.updateMany({ where: { id: sessionId, userId: user.id, revokedAt: null }, data: { revokedAt: now } });
    throw new ApiError(401, 'リフレッシュトークンが無効です');
  }
  const session = await prisma.authSession.findUniqueOrThrow({ where: { id: sessionId } });
  return sessionTokens(user, { ...session, refreshTokenId: nextId });
}

export async function updateMfaState(userId: string, data: Prisma.UserUpdateInput, exceptSessionId?: string): Promise<User> {
  return prisma.$transaction(async (tx) => {
    const user = await tx.user.update({ where: { id: userId }, data });
    await revokeUserSessions(userId, exceptSessionId, tx);
    return user;
  });
}
