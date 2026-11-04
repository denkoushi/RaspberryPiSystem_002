import Fastify, { type FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Replace the auth services so the real auth routes can be registered without a DB.
vi.mock('../../services/auth/auth.service.js', () => ({
  AuthService: class {
    login = vi.fn(async () => ({ ok: 'login' }));
    refresh = vi.fn(async () => ({ ok: 'refresh' }));
  },
}));
vi.mock('../../services/auth/auth-role-admin.service.js', () => ({
  AuthRoleAdminService: class {},
}));

import { registerAuthRoutes } from '../../routes/auth.js';
import { registerRateLimit } from '../rate-limit.js';

const BASE_TIME = new Date('2026-01-15T00:00:00.000Z');

let app: FastifyInstance;

beforeEach(async () => {
  // Only Date is faked: @fastify/rate-limit's LocalStore measures windows with Date.now().
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(BASE_TIME);

  app = Fastify();
  await app.register(registerRateLimit);
  const ok = async () => ({ ok: true });
  app.get('/api/tools/items', ok);
  app.get('/api/tools/loans/borrow', ok);
  app.get('/api/tools/loans/history', ok);
  app.get('/api/kiosk/config', ok);
  app.get('/api/admin/thing', ok);
  app.get('/api/admin/other', ok);
  // Generic catch-all used for allow-list checks so every prefix hits a real route.
  app.get('/*', ok);
  await app.register(registerAuthRoutes, { prefix: '/api' });
  await app.ready();
});

afterEach(async () => {
  await app.close();
  vi.useRealTimers();
});

async function hit(url: string, times: number, headers: Record<string, string> = {}, method: 'GET' | 'POST' = 'GET', payload?: unknown) {
  const codes: number[] = [];
  for (let i = 0; i < times; i += 1) {
    const res = await app.inject({ method, url, headers, payload: payload as never });
    codes.push(res.statusCode);
  }
  return codes;
}

describe('registerRateLimit', () => {
  it('allows 120 requests per minute per endpoint and IP, then returns 429', async () => {
    const codes = await hit('/api/admin/thing', 120);
    expect(codes.every((c) => c === 200)).toBe(true);

    const blocked = await app.inject({ method: 'GET', url: '/api/admin/thing' });
    expect(blocked.statusCode).toBe(429);
    expect(blocked.json()).toMatchObject({ statusCode: 429, error: 'Too Many Requests' });
    expect(blocked.json().message).toMatch(/^Rate limit exceeded\. Retry in /);
  });

  it('keeps blocking until the full 1-minute window has elapsed, then resets', async () => {
    await hit('/api/admin/thing', 121);

    vi.setSystemTime(new Date(BASE_TIME.getTime() + 59_000));
    expect((await app.inject({ method: 'GET', url: '/api/admin/thing' })).statusCode).toBe(429);

    vi.setSystemTime(new Date(BASE_TIME.getTime() + 60_000));
    expect((await app.inject({ method: 'GET', url: '/api/admin/thing' })).statusCode).toBe(200);
  });

  it('counts each endpoint separately and ignores the query string', async () => {
    await hit('/api/admin/thing?page=1', 60);
    await hit('/api/admin/thing?page=2', 60);
    expect((await app.inject({ method: 'GET', url: '/api/admin/thing?page=3' })).statusCode).toBe(429);
    expect((await app.inject({ method: 'GET', url: '/api/admin/other' })).statusCode).toBe(200);
  });

  it('counts each client IP separately', async () => {
    await hit('/api/admin/thing', 121);
    const other = await app.inject({ method: 'GET', url: '/api/admin/thing', remoteAddress: '10.9.9.9' });
    expect(other.statusCode).toBe(200);
  });

  it.each([
    '/api/kiosk/support/x',
    '/api/kiosk/power/x',
    '/api/tools/loans/active',
    '/api/tools/loans/borrow',
    '/api/tools/loans/return',
    '/api/tools/transactions',
    '/api/tools/employees',
    '/api/tools/items',
    '/api/imports/x',
    '/ws/x',
    '/api/signage/x',
    '/api/storage/x',
  ])('never limits allow-listed path %s', async (path) => {
    const codes = await hit(`${path}?q=1`, 125);
    expect(codes.every((c) => c === 200)).toBe(true);
  });

  it('still limits non-allow-listed paths under /api/tools/loans and /api/kiosk', async () => {
    expect((await hit('/api/tools/loans/history', 121)).at(-1)).toBe(429);
    expect((await hit('/api/kiosk/other', 121)).at(-1)).toBe(429);
  });

  it('counts kiosk requests per client key, normalising JSON-quoted keys', async () => {
    await hit('/api/kiosk/config', 120, { 'x-client-key': 'kiosk-a' });
    // Same key spelled as JSON string shares the counter.
    expect((await app.inject({ method: 'GET', url: '/api/kiosk/config', headers: { 'x-client-key': '"kiosk-a"' } })).statusCode).toBe(429);
    // A different kiosk on the same IP is not affected.
    expect((await app.inject({ method: 'GET', url: '/api/kiosk/config', headers: { 'x-client-key': 'kiosk-b' } })).statusCode).toBe(200);
    // Requests without a key share an "anonymous" bucket separate from keyed kiosks.
    expect((await app.inject({ method: 'GET', url: '/api/kiosk/config' })).statusCode).toBe(200);
  });

  it.each([
    ['/api/auth/login', { username: 'u', password: 'p' }],
    ['/api/auth/refresh', { refreshToken: 't' }],
  ])('real auth route %s is limited to 10 requests per minute', async (url, payload) => {
    const codes = await hit(url, 11, {}, 'POST', payload);
    expect(codes.slice(0, 10)).toEqual(Array(10).fill(200));
    expect(codes[10]).toBe(429);

    // Window for the auth limit is also 1 minute.
    vi.setSystemTime(new Date(BASE_TIME.getTime() + 59_000));
    expect((await app.inject({ method: 'POST', url, payload })).statusCode).toBe(429);
    vi.setSystemTime(new Date(BASE_TIME.getTime() + 60_000));
    expect((await app.inject({ method: 'POST', url, payload })).statusCode).toBe(200);
  });
});
