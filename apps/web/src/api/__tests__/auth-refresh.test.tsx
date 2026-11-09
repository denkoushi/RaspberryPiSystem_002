import { act, cleanup, render } from '@testing-library/react';
import { AxiosError } from 'axios';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AuthProvider, useAuth } from '../../contexts/AuthContext';
import { api, setAuthToken } from '../http';

import type { AuthResponse } from '../types';
import type { AxiosAdapter, InternalAxiosRequestConfig } from 'axios';

const originalAdapter = api.defaults.adapter;
const first: AuthResponse = { accessToken: 'old', refreshToken: 'refresh-old', user: { id: 'u1', username: 'alice', role: 'ADMIN', mfaEnabled: true } };
const next: AuthResponse = { ...first, accessToken: 'new', refreshToken: 'refresh-new', user: { ...first.user, username: 'updated' } };
let auth: ReturnType<typeof useAuth>;
let refreshCount: number;
let attempts: string[];
let originalErrors: AxiosError[];
let refreshFailure: false | number | 'network' | 'timeout';
let retryFailure: boolean;
let releaseRefresh: (() => void) | undefined;
let refreshGate: Promise<void> | undefined;
let requestErrorData: object;

function Harness() { auth = useAuth(); return null; }
function unauthorized(config: InternalAxiosRequestConfig, data = {}) {
  const error = new AxiosError('unauthorized', 'ERR_BAD_REQUEST', config, undefined, { config, status: 401, statusText: 'Unauthorized', headers: {}, data });
  return error;
}
const adapter: AxiosAdapter = async (config) => {
  const response = (data: unknown) => ({ data, status: 200, statusText: 'OK', headers: {}, config });
  if (config.url === '/auth/login') return response(first);
  if (config.url === '/auth/logout') return response({});
  if (config.url === '/auth/refresh') {
    refreshCount++;
    expect(JSON.parse(config.data).refreshToken).toBe(first.refreshToken);
    await refreshGate;
    if (refreshFailure === 'network' || refreshFailure === 'timeout') {
      throw new AxiosError('refresh unavailable', refreshFailure === 'timeout' ? 'ECONNABORTED' : 'ERR_NETWORK', config);
    }
    if (refreshFailure) throw new AxiosError('refresh rejected', 'ERR_BAD_RESPONSE', config, undefined, {
      config, status: refreshFailure, statusText: 'Refresh failed', headers: {}, data: {}
    });
    return response(next);
  }
  attempts.push(String(config.headers.get('Authorization')));
  if (config.headers.get('Authorization') === 'Bearer new' && !retryFailure) return response({ ok: true });
  const error = unauthorized(config, requestErrorData);
  originalErrors.push(error);
  throw error;
};
async function login(rememberMe = true) {
  render(<AuthProvider><Harness /></AuthProvider>);
  await act(async () => { await auth.login('alice', 'password', { rememberMe }); });
}
async function request() {
  let result: unknown;
  await act(async () => { result = await api.get('/protected').catch((error: unknown) => error); });
  return result;
}
beforeEach(() => {
  localStorage.clear(); sessionStorage.clear(); setAuthToken(undefined);
  refreshCount = 0; attempts = []; originalErrors = []; refreshFailure = false; retryFailure = false;
  refreshGate = undefined; releaseRefresh = undefined; requestErrorData = {};
  api.defaults.adapter = adapter;
});
afterEach(() => { cleanup(); api.defaults.adapter = originalAdapter; setAuthToken(undefined); vi.unstubAllGlobals(); });

describe('admin auth refresh', () => {
  it.each([true, false])('refreshes once and updates context and tokens (rememberMe=%s)', async (rememberMe) => {
    await login(rememberMe);
    const { expiresAt, loginId } = JSON.parse(localStorage.getItem('factory-auth') ?? '{}');
    const storageWrite = vi.spyOn(Storage.prototype, 'setItem');
    await request();
    expect(refreshCount).toBe(1);
    expect(attempts).toEqual(['Bearer old', 'Bearer new']);
    expect(auth.token).toBe('new'); expect(auth.user).toEqual(next.user);
    expect(api.defaults.headers.common.Authorization).toBe('Bearer new');
    if (rememberMe) {
      expect(JSON.parse(localStorage.getItem('factory-auth')!)).toEqual({ token: 'new', refresh: 'refresh-new', user: next.user, expiresAt, loginId });
    } else {
      expect(localStorage.getItem('factory-auth')).toBeNull();
      expect(storageWrite).not.toHaveBeenCalled();
      expect(sessionStorage.getItem('factory-auth')).toBeNull();
    }
    storageWrite.mockRestore();
  });
  it('shares refresh between simultaneous 401 responses', async () => {
    await login();
    refreshGate = new Promise<void>((resolve) => { releaseRefresh = resolve; });
    await act(async () => {
      const requests = Promise.all([api.get('/one'), api.get('/two')]);
      await vi.waitFor(() => expect(refreshCount).toBe(1));
      releaseRefresh!();
      await requests;
    });
    expect(refreshCount).toBe(1);
    expect(attempts).toEqual(['Bearer old', 'Bearer old', 'Bearer new', 'Bearer new']);
  });
  it.each([true, false])('clears session and returns the original error on refresh failure (rememberMe=%s)', async (rememberMe) => {
    await login(rememberMe); refreshFailure = 401;
    expect(await request()).toBe(originalErrors[0]);
    expect(refreshCount).toBe(1); expect(auth.token).toBeNull(); expect(auth.user).toBeNull();
    expect(localStorage.getItem('factory-auth')).toBeNull();
    expect(api.defaults.headers.common.Authorization).toBeUndefined();
    setAuthToken('old'); await request(); expect(refreshCount).toBe(1);
  });
  it.each(['network', 'timeout', 500, 429] as const)('preserves session and returns the original error on transient refresh failure (%s)', async (failure) => {
    await login(); refreshFailure = failure;
    const stored = localStorage.getItem('factory-auth');
    expect(await request()).toBe(originalErrors[0]);
    expect(refreshCount).toBe(1); expect(attempts).toEqual(['Bearer old']);
    expect(auth.token).toBe('old'); expect(auth.user).toEqual(first.user);
    expect(localStorage.getItem('factory-auth')).toBe(stored);
    expect(api.defaults.headers.common.Authorization).toBe('Bearer old');

    refreshFailure = false;
    await request();
    expect(refreshCount).toBe(2); expect(attempts).toEqual(['Bearer old', 'Bearer old', 'Bearer new']);
    expect(auth.token).toBe('new');
  });
  it('never refreshes a retried request a second time', async () => {
    await login(); retryFailure = true;
    expect(await request()).toBe(originalErrors[1]);
    expect(refreshCount).toBe(1); expect(attempts).toHaveLength(2);
  });
  it.each(['/auth/login', '/auth/refresh', '/auth/logout'])('does not refresh %s itself', async (url) => {
    await login();
    const calls: string[] = [];
    api.defaults.adapter = async (config) => { calls.push(config.url!); throw unauthorized(config); };
    await act(async () => { await api.post(url).catch(() => undefined); });
    expect(calls).toEqual([url]); expect(auth.token).toBe('old');
  });
  it.each([
    { code: 'INVALID_CLIENT_KEY' }, { code: 'CLIENT_KEY_INVALID' },
    { errorCode: 'CLIENT_KEY_INVALID', message: 'クライアントキーが無効です', requestId: 'req-1', timestamp: '2026-11-09T00:00:00.000Z' },
    { errorCode: 'INVALID_CLIENT_KEY' }, { message: 'クライアントキーが無効です' },
    { message: '無効なクライアントキー' }, { message: 'Invalid client key' }
  ])('preserves invalid client key handling: %s', async (data) => {
    await login(); requestErrorData = data; await request(); expect(refreshCount).toBe(0);
  });
  it('does not refresh without a Bearer header', async () => {
    await login(); setAuthToken(undefined); await request(); expect(refreshCount).toBe(0);
  });
  it('clears an expired stored session without refreshing', async () => {
    await login();
    const stored = JSON.parse(localStorage.getItem('factory-auth')!);
    localStorage.setItem('factory-auth', JSON.stringify({ ...stored, expiresAt: new Date(Date.now() - 1).toISOString() }));
    await request();
    expect(refreshCount).toBe(0); expect(auth.token).toBeNull(); expect(localStorage.getItem('factory-auth')).toBeNull();
  });
  it('discards an expired session on initial load', () => {
    localStorage.setItem('factory-auth', JSON.stringify({ token: 'old', refresh: 'refresh-old', user: first.user, expiresAt: new Date(Date.now() - 1).toISOString() }));
    render(<AuthProvider><Harness /></AuthProvider>);
    expect(auth.token).toBeNull(); expect(localStorage.getItem('factory-auth')).toBeNull();
  });
  it.each([false, true])('reuses another tab tokens after re-reading storage (locks=%s)', async (locks) => {
    await login();
    const replaceTokens = () => {
      const stored = JSON.parse(localStorage.getItem('factory-auth')!);
      localStorage.setItem('factory-auth', JSON.stringify({ ...stored, token: next.accessToken, refresh: next.refreshToken, user: next.user }));
    };
    const lockRequest = vi.fn(async (_name: string, callback: () => Promise<unknown>) => { replaceTokens(); return callback(); });
    vi.stubGlobal('navigator', locks ? { locks: { request: lockRequest } } : {});
    if (!locks) replaceTokens();
    await request();
    expect(refreshCount).toBe(0); expect(attempts).toEqual(['Bearer old', 'Bearer new']);
    expect(auth.token).toBe('new'); expect(auth.user).toEqual(next.user);
    if (locks) expect(lockRequest).toHaveBeenCalledOnce();
  });
  it.each([true, false])('removes refresh tokens after logout (rememberMe=%s)', async (rememberMe) => {
    await login(rememberMe); await act(async () => { await auth.logout(); });
    expect(localStorage.getItem('factory-auth')).toBeNull(); expect(auth.token).toBeNull();
    setAuthToken('old'); await request(); expect(refreshCount).toBe(0);
  });
  it('does not restore login when an in-flight refresh completes after logout', async () => {
    await login();
    refreshGate = new Promise<void>((resolve) => { releaseRefresh = resolve; });
    await act(async () => {
      const pending = api.get('/protected').catch((error: unknown) => error);
      await vi.waitFor(() => expect(refreshCount).toBe(1));
      await auth.logout(); releaseRefresh!(); await pending;
    });
    expect(auth.token).toBeNull(); expect(localStorage.getItem('factory-auth')).toBeNull(); expect(attempts).toHaveLength(1);
  });
  it.each(['bob', 'alice'])('does not retry an old login request after logging in as %s', async (username) => {
    await login();
    const storedId = JSON.parse(localStorage.getItem('factory-auth')!).loginId;
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    let sent!: () => void;
    const started = new Promise<void>((resolve) => { sent = resolve; });
    api.defaults.adapter = async (config) => {
      if (config.url === '/auth/login') return { data: { ...first, user: { ...first.user, username } }, status: 200, statusText: 'OK', headers: {}, config };
      attempts.push(String(config.headers.get('Authorization')));
      sent();
      await gate;
      const error = unauthorized(config);
      originalErrors.push(error);
      throw error;
    };
    await act(async () => {
      const pending = api.get('/protected').catch((error: unknown) => error);
      await started;
      await auth.login(username, 'password', { rememberMe: true });
      expect(JSON.parse(localStorage.getItem('factory-auth')!).loginId).not.toBe(storedId);
      release();
      expect(await pending).toBe(originalErrors[0]);
    });
    expect(attempts).toHaveLength(1); expect(refreshCount).toBe(0);
  });
  it('does not save or retry a refresh after a new login', async () => {
    await login();
    refreshGate = new Promise<void>((resolve) => { releaseRefresh = resolve; });
    await act(async () => {
      const pending = api.get('/protected').catch((error: unknown) => error);
      await vi.waitFor(() => expect(refreshCount).toBe(1));
      await auth.login('alice', 'password', { rememberMe: true });
      const stored = localStorage.getItem('factory-auth');
      releaseRefresh!();
      expect(await pending).toBe(originalErrors[0]);
      expect(localStorage.getItem('factory-auth')).toBe(stored);
    });
    expect(auth.token).toBe('old'); expect(attempts).toHaveLength(1);
  });
  it.each([false, true])('refreshes the new login once after an old login refresh finishes (old refresh rejected=%s)', async (oldRejected) => {
    await login();
    const second: AuthResponse = { ...first, accessToken: 'bob-old', refreshToken: 'bob-refresh', user: { ...first.user, id: 'u2', username: 'bob' } };
    const secondNext: AuthResponse = { ...second, accessToken: 'bob-new', refreshToken: 'bob-refresh-new' };
    const refreshTokens: string[] = [];
    let releaseOld!: () => void;
    let releaseNew!: () => void;
    const oldGate = new Promise<void>((resolve) => { releaseOld = resolve; });
    const newGate = new Promise<void>((resolve) => { releaseNew = resolve; });
    api.defaults.adapter = async (config) => {
      const response = (data: unknown) => ({ data, status: 200, statusText: 'OK', headers: {}, config });
      if (config.url === '/auth/login') return response(second);
      if (config.url === '/auth/refresh') {
        const refreshToken = JSON.parse(config.data).refreshToken;
        refreshTokens.push(refreshToken);
        if (refreshToken === first.refreshToken) {
          await oldGate;
          if (oldRejected) throw unauthorized(config);
          return response(next);
        }
        expect(refreshToken).toBe(second.refreshToken);
        await newGate;
        return response(secondNext);
      }
      attempts.push(String(config.headers.get('Authorization')));
      if (config.headers.get('Authorization') === 'Bearer bob-new') return response({ ok: true });
      const error = unauthorized(config);
      originalErrors.push(error);
      throw error;
    };
    await act(async () => {
      const oldRequest = api.get('/alice').catch((error: unknown) => error);
      await vi.waitFor(() => expect(refreshTokens).toEqual([first.refreshToken]));
      await auth.login('bob', 'password', { rememberMe: true });
      const stored = JSON.parse(localStorage.getItem('factory-auth')!);
      const newRequests = Promise.all([api.get('/bob-one'), api.get('/bob-two')]);
      await vi.waitFor(() => expect(attempts).toEqual(['Bearer old', 'Bearer bob-old', 'Bearer bob-old']));
      releaseOld();
      expect(await oldRequest).toBe(originalErrors[0]);
      await vi.waitFor(() => expect(refreshTokens).toEqual([first.refreshToken, second.refreshToken]));
      expect(localStorage.getItem('factory-auth')).toBe(JSON.stringify(stored));
      releaseNew();
      expect((await newRequests).map(({ data }) => data)).toEqual([{ ok: true }, { ok: true }]);
      expect(JSON.parse(localStorage.getItem('factory-auth')!)).toEqual({ ...stored, token: secondNext.accessToken, refresh: secondNext.refreshToken });
    });
    expect(refreshTokens).toEqual([first.refreshToken, second.refreshToken]);
    expect(attempts).toEqual(['Bearer old', 'Bearer bob-old', 'Bearer bob-old', 'Bearer bob-new', 'Bearer bob-new']);
    expect(auth.token).toBe(secondNext.accessToken); expect(auth.user).toEqual(second.user);
    expect(api.defaults.headers.common.Authorization).toBe('Bearer bob-new');
  });
  it('expires a non-remembered login without refreshing or writing storage', async () => {
    await login(false);
    const now = Date.now();
    const clock = vi.spyOn(Date, 'now').mockReturnValue(now + 7 * 24 * 60 * 60 * 1000 + 1);
    const write = vi.spyOn(Storage.prototype, 'setItem');
    try {
      expect(await request()).toBe(originalErrors[0]);
      expect(refreshCount).toBe(0); expect(auth.token).toBeNull(); expect(auth.user).toBeNull();
      expect(api.defaults.headers.common.Authorization).toBeUndefined();
      expect(write).not.toHaveBeenCalled();
    } finally { clock.mockRestore(); write.mockRestore(); }
  });
  it.each(['logout', 'new login'])('clears remembered memory after another tab %s', async (change) => {
    await login();
    const oldValue = localStorage.getItem('factory-auth');
    const newValue = change === 'logout' ? null : JSON.stringify({ ...JSON.parse(oldValue!), loginId: 'other-login' });
    await act(async () => {
      if (newValue) localStorage.setItem('factory-auth', newValue);
      else localStorage.removeItem('factory-auth');
      window.dispatchEvent(new StorageEvent('storage', { key: 'factory-auth', oldValue, newValue, storageArea: localStorage }));
    });
    expect(auth.token).toBeNull(); expect(auth.user).toBeNull();
    expect(api.defaults.headers.common.Authorization).toBeUndefined();
    expect(localStorage.getItem('factory-auth')).toBe(newValue);
    setAuthToken('old'); await request(); expect(refreshCount).toBe(0);
  });
  it('adopts tokens from another tab refresh with the same loginId', async () => {
    await login();
    const stored = JSON.parse(localStorage.getItem('factory-auth')!);
    const newValue = JSON.stringify({ ...stored, token: 'new', refresh: 'refresh-new', user: next.user });
    await act(async () => {
      localStorage.setItem('factory-auth', newValue);
      window.dispatchEvent(new StorageEvent('storage', { key: 'factory-auth', newValue, storageArea: localStorage }));
    });
    expect(auth.token).toBe('new'); expect(auth.user).toEqual(next.user);
    expect(api.defaults.headers.common.Authorization).toBe('Bearer new');
    api.defaults.adapter = async (config) => {
      if (config.url === '/auth/refresh') {
        expect(JSON.parse(config.data).refreshToken).toBe('refresh-new');
        refreshCount++;
        return { data: { ...next, accessToken: 'newer' }, status: 200, statusText: 'OK', headers: {}, config };
      }
      if (!config.authRetried) throw unauthorized(config);
      return { data: {}, status: 200, statusText: 'OK', headers: {}, config };
    };
    await request(); expect(refreshCount).toBe(1);
    expect(JSON.parse(localStorage.getItem('factory-auth')!).expiresAt).toBe(stored.expiresAt);
  });
  it('ignores storage events for a non-remembered login', async () => {
    await login(false);
    await act(async () => {
      window.dispatchEvent(new StorageEvent('storage', { key: 'factory-auth', newValue: null, storageArea: localStorage }));
    });
    expect(auth.token).toBe('old'); await request(); expect(refreshCount).toBe(1);
  });
  it('does not overwrite another login stored just before refresh persistence', async () => {
    await login();
    const other = JSON.stringify({ ...JSON.parse(localStorage.getItem('factory-auth')!), loginId: 'other-login', token: 'other', refresh: 'other-refresh' });
    const baseAdapter = api.defaults.adapter as AxiosAdapter;
    vi.stubGlobal('navigator', { locks: { request: vi.fn(async (_name: string, callback: () => Promise<unknown>) => callback()) } });
    api.defaults.adapter = async (config) => {
      const result = await baseAdapter(config);
      if (config.url === '/auth/refresh') localStorage.setItem('factory-auth', other);
      return result;
    };
    expect(await request()).toBe(originalErrors[0]);
    expect(localStorage.getItem('factory-auth')).toBe(other);
    expect(attempts).toHaveLength(1); expect(auth.token).toBeNull();
  });
  it('preserves loginId and the original expiry through MFA token updates', async () => {
    await login();
    const stored = JSON.parse(localStorage.getItem('factory-auth')!);
    await act(async () => { auth.updateSession(next); });
    expect(JSON.parse(localStorage.getItem('factory-auth')!)).toEqual({ ...stored, token: 'new', refresh: 'refresh-new', user: next.user });
  });
  it('assigns and persists a loginId when loading a legacy session', async () => {
    localStorage.setItem('factory-auth', JSON.stringify({ token: 'old', refresh: 'refresh-old', user: first.user, expiresAt: new Date(Date.now() + 10000).toISOString() }));
    await act(async () => { render(<AuthProvider><Harness /></AuthProvider>); });
    expect(JSON.parse(localStorage.getItem('factory-auth')!).loginId).toEqual(expect.any(String));
    await request(); expect(refreshCount).toBe(1);
  });

  it.each(['login', 'logout'])('serializes %s persistence with an in-flight refresh', async (action) => {
    await login();
    const oldLoginId = JSON.parse(localStorage.getItem('factory-auth')!).loginId;
    let tail = Promise.resolve<unknown>(undefined);
    let locked = false;
    const lock = vi.fn((_name: string, callback: () => Promise<unknown>) => {
      const pending = tail.then(async () => {
        locked = true;
        try { return await callback(); } finally { locked = false; }
      });
      tail = pending.catch(() => undefined);
      return pending;
    });
    vi.stubGlobal('navigator', { locks: { request: lock } });
    const originalSet = Storage.prototype.setItem;
    const originalRemove = Storage.prototype.removeItem;
    const write = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (this: Storage, key, value) {
      if (key === 'factory-auth') expect(locked).toBe(true);
      originalSet.call(this, key, value);
    });
    const remove = vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(function (this: Storage, key) {
      if (key === 'factory-auth') expect(locked).toBe(true);
      originalRemove.call(this, key);
    });
    refreshGate = new Promise<void>((resolve) => { releaseRefresh = resolve; });
    try {
      await act(async () => {
        const pending = api.get('/protected').catch((error: unknown) => error);
        await vi.waitFor(() => expect(refreshCount).toBe(1));
        const changing = action === 'login' ? auth.login('alice', 'password', { rememberMe: true }) : auth.logout();
        await vi.waitFor(() => expect(lock).toHaveBeenCalledTimes(2));
        // A storage event from the previous login must not cancel the queued login.
        window.dispatchEvent(new StorageEvent('storage', { key: 'factory-auth', newValue: localStorage.getItem('factory-auth'), storageArea: localStorage }));
        releaseRefresh!();
        expect(await pending).toBe(originalErrors[0]);
        await changing;
      });
      expect(attempts).toHaveLength(1);
      if (action === 'login') {
        const stored = JSON.parse(localStorage.getItem('factory-auth')!);
        expect(stored.loginId).not.toBe(oldLoginId); expect(stored.refresh).toBe('refresh-old');
        expect(auth.token).toBe('old');
      } else {
        expect(localStorage.getItem('factory-auth')).toBeNull(); expect(auth.token).toBeNull();
      }
    } finally { write.mockRestore(); remove.mockRestore(); }
  });

});
