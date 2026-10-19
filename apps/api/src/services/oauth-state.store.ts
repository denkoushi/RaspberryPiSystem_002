import crypto from 'crypto';

import { ApiError } from '../lib/errors.js';

type OAuthProvider = 'dropbox' | 'gmail';
type OAuthState = {
  userId: string;
  provider: OAuthProvider;
  expiresAt: number;
};

const STATE_TTL_MS = 10 * 60 * 1000;
const MAX_STATES = 1000;
const states = new Map<string, OAuthState>();

function removeExpiredStates(now: number): void {
  for (const [state, entry] of states) {
    if (entry.expiresAt <= now) {
      states.delete(state);
    }
  }
}

export function issueOAuthState(userId: string, provider: OAuthProvider): string {
  const now = Date.now();
  removeExpiredStates(now);
  if (states.size >= MAX_STATES) {
    throw new ApiError(503, 'Too many pending OAuth authorizations');
  }

  const state = crypto.randomBytes(32).toString('hex');
  states.set(state, { userId, provider, expiresAt: now + STATE_TTL_MS });
  return state;
}

export function consumeOAuthState(state: unknown, provider: OAuthProvider): OAuthState {
  removeExpiredStates(Date.now());
  const entry = typeof state === 'string' ? states.get(state) : undefined;
  if (typeof state === 'string') {
    states.delete(state);
  }
  if (!entry || entry.provider !== provider) {
    throw new ApiError(400, 'Invalid or expired OAuth state', undefined, 'VALIDATION_ERROR');
  }
  return entry;
}
