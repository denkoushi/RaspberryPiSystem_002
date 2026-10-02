import Fastify from 'fastify';
import { describe, expect, it } from 'vitest';

import { authenticate, authorizeRoles } from '../auth.js';

describe('authenticate', () => {
  it('rejects an invalid token with 401', async () => {
    const app = Fastify();
    app.get('/guarded', { preHandler: [authorizeRoles('ADMIN')] }, async () => ({ ok: true }));

    const response = await app.inject({ method: 'GET', url: '/guarded', headers: { authorization: 'Bearer stale-token' } });

    expect(response.statusCode).toBe(401);
    await app.close();
  });

  it('leaves the reply untouched so a caller that falls back to another credential answers 200', async () => {
    // A kiosk browser that once logged in to the admin console keeps sending its expired token.
    // The stock change went through on the client key but the response said 401 (2026-10-02).
    const app = Fastify();
    app.post('/fallback', {
      preHandler: [async (request, reply) => {
        try {
          await authenticate(request, reply);
        } catch (error) {
          if (!request.headers['x-client-key']) throw error;
        }
      }],
    }, async () => ({ ok: true }));

    const response = await app.inject({ method: 'POST', url: '/fallback', headers: { authorization: 'Bearer stale-token', 'x-client-key': 'kiosk' } });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ ok: true });
    await app.close();
  });
});
