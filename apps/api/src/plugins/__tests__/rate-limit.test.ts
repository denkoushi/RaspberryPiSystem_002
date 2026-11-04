import Fastify from 'fastify';
import { describe, expect, it } from 'vitest';
import { normalizeRateLimitPath, registerRateLimit } from '../rate-limit.js';

async function buildApp() {
  const app = Fastify();
  await registerRateLimit(app);
  app.post('/api/auth/login', { config: { rateLimit: { max: 2, timeWindow: '1 minute' } } }, async () => ({ ok: true }));
  app.post(
    '/api/kiosk/production-schedule/due-management/verify-access-password',
    { config: { rateLimit: { max: 2, timeWindow: '1 minute' } } },
    async () => ({ ok: true })
  );
  await app.ready();
  return app;
}

describe('normalizeRateLimitPath', () => {
  it('removes the query string and decodes percent-encoding once', () => {
    expect(normalizeRateLimitPath('/api/auth/logi%6E?x=1')).toBe('/api/auth/login');
    expect(normalizeRateLimitPath('/api/%61uth/login')).toBe('/api/auth/login');
  });

  it('keeps the raw path when decoding fails', () => {
    expect(normalizeRateLimitPath('/api/bad%zz')).toBe('/api/bad%zz');
  });
});

describe('registerRateLimit', () => {
  it('counts percent-encoded spellings of a route in the same bucket', async () => {
    const app = await buildApp();
    try {
      for (let i = 0; i < 2; i += 1) {
        expect((await app.inject({ method: 'POST', url: '/api/auth/login' })).statusCode).toBe(200);
      }
      for (const url of ['/api/auth/login', '/api/auth/logi%6E', '/api/auth/%6Cogin', '/api/%61uth/login']) {
        expect((await app.inject({ method: 'POST', url })).statusCode).toBe(429);
      }
    } finally {
      await app.close();
    }
  });

  it('applies the same normalization to kiosk routes keyed by client key', async () => {
    const app = await buildApp();
    const headers = { 'x-client-key': 'client-key-test' };
    const url = '/api/kiosk/production-schedule/due-management/verify-access-password';
    try {
      for (let i = 0; i < 2; i += 1) {
        expect((await app.inject({ method: 'POST', url, headers })).statusCode).toBe(200);
      }
      const encoded = url.replace('verify', '%76erify');
      expect((await app.inject({ method: 'POST', url: encoded, headers })).statusCode).toBe(429);
    } finally {
      await app.close();
    }
  });
});
