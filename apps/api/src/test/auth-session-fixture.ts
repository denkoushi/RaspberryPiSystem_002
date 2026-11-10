import type { User } from '@prisma/client';
import { signAccessToken } from '../lib/auth.js';

/** User-token fixtures still exercise the real authentication middleware. */
export function signTestAccessToken(user: User): string {
  return signAccessToken(user, user.id);
}
