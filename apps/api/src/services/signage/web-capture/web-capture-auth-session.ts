import { randomUUID } from 'node:crypto';
import type { User } from '@prisma/client';
import { prisma } from '../../../lib/prisma.js';
import { signAccessToken } from '../../../lib/auth.js';
import { deleteExpiredAuthSessions } from '../../auth/auth-session.service.js';

export async function signWebCaptureToken(user: Pick<User, 'id' | 'username' | 'role'>): Promise<string> {
  await deleteExpiredAuthSessions();
  const session = await prisma.authSession.create({ data: {
    userId: user.id, expiresAt: new Date(Date.now() + 15 * 60 * 1000), refreshTokenId: randomUUID()
  } });
  return signAccessToken(user as User, session.id);
}
