import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

describe('OAuth state store', () => {
  let store: typeof import('../oauth-state.store.js');
  let now: number;

  beforeEach(async () => {
    vi.resetModules();
    store = await import('../oauth-state.store.js');
    now = 1_000_000;
    vi.spyOn(Date, 'now').mockImplementation(() => now);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it.each(['dropbox', 'gmail'] as const)('stores issuer and expiry for %s', (provider) => {
    const state = store.issueOAuthState('admin-id', provider);
    expect(state).toMatch(/^[a-f0-9]{64}$/);
    expect(store.consumeOAuthState(state, provider)).toEqual({
      userId: 'admin-id', provider, expiresAt: now + 600_000
    });
    expect(() => store.consumeOAuthState(state, provider)).toThrow('Invalid or expired OAuth state');
  });

  it('accepts a state just before expiry', () => {
    const state = store.issueOAuthState('admin-id', 'gmail');
    now += 599_999;
    expect(store.consumeOAuthState(state, 'gmail').userId).toBe('admin-id');
  });

  it('limits pending states and removes expired entries before issuing', () => {
    const states = Array.from({ length: 1000 }, () => store.issueOAuthState('admin-id', 'gmail'));
    expect(new Set(states).size).toBe(1000);
    expect(() => store.issueOAuthState('admin-id', 'gmail')).toThrow(
      expect.objectContaining({ statusCode: 503 })
    );
    now += 600_000;
    expect(() => store.issueOAuthState('admin-id', 'gmail')).not.toThrow();
    expect(() => store.consumeOAuthState(states[0], 'gmail')).toThrow(
      expect.objectContaining({ statusCode: 400 })
    );
  });

  it('releases capacity when a state is consumed', () => {
    const states = Array.from({ length: 1000 }, () => store.issueOAuthState('admin-id', 'dropbox'));
    store.consumeOAuthState(states[0], 'dropbox');
    expect(() => store.issueOAuthState('admin-id', 'gmail')).not.toThrow();
  });
});
