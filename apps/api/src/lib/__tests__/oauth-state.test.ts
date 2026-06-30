import { describe, expect, it } from 'vitest';

import { ApiError } from '../errors.js';
import { createOAuthState, verifyOAuthState } from '../oauth-state.js';

describe('OAuth state', () => {
  const secret = 'test-oauth-state-secret-with-enough-length';
  const nowMs = 1_800_000_000_000;

  it('accepts a valid state for the same provider and secret', () => {
    const state = createOAuthState('dropbox', secret, nowMs);

    expect(() => verifyOAuthState(state, 'dropbox', secret, { nowMs })).not.toThrow();
  });

  it('rejects a state for another provider', () => {
    const state = createOAuthState('dropbox', secret, nowMs);

    expect(() => verifyOAuthState(state, 'gmail', secret, { nowMs })).toThrow(ApiError);
  });

  it('rejects a tampered state', () => {
    const state = createOAuthState('gmail', secret, nowMs);

    expect(() => verifyOAuthState(`${state}x`, 'gmail', secret, { nowMs })).toThrow(ApiError);
  });

  it('rejects an expired state', () => {
    const state = createOAuthState('gmail', secret, nowMs);

    expect(() =>
      verifyOAuthState(state, 'gmail', secret, {
        nowMs: nowMs + 11 * 60 * 1000,
      })
    ).toThrow(ApiError);
  });
});
