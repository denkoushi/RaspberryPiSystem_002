import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { buildServer } from '../../../app.js';
import { createAuthHeader, createTestUser } from '../../__tests__/helpers.js';

process.env.DATABASE_URL ??= 'postgresql://postgres:postgres@localhost:5432/borrow_return';
process.env.JWT_ACCESS_SECRET ??= 'test-access-secret-1234567890';
process.env.JWT_REFRESH_SECRET ??= 'test-refresh-secret-1234567890';

describe('system diagnostics authorization', () => {
  let app: Awaited<ReturnType<typeof buildServer>>;
  let adminHeaders: Record<string, string>;
  let managerHeaders: Record<string, string>;
  let viewerHeaders: Record<string, string>;

  beforeAll(async () => {
    app = await buildServer();
    const admin = await createTestUser('ADMIN');
    const manager = await createTestUser('MANAGER');
    const viewer = await createTestUser('VIEWER');
    adminHeaders = createAuthHeader(admin.token);
    managerHeaders = createAuthHeader(manager.token);
    viewerHeaders = createAuthHeader(viewer.token);
  });

  afterAll(async () => {
    await app.close();
  });

  it.each([
    ['/api/system/metrics', 'text'],
    ['/api/system/system-info', 'json'],
  ] as const)('requires ADMIN or MANAGER for %s', async (url, responseKind) => {
    const unauth = await app.inject({ method: 'GET', url });
    expect(unauth.statusCode).toBe(401);

    const viewer = await app.inject({ method: 'GET', url, headers: viewerHeaders });
    expect(viewer.statusCode).toBe(403);

    for (const headers of [adminHeaders, managerHeaders]) {
      const allowed = await app.inject({ method: 'GET', url, headers });
      expect(allowed.statusCode, allowed.body).toBe(200);
      if (responseKind === 'text') {
        expect(String(allowed.headers['content-type'])).toContain('text/plain');
        expect(allowed.body).toContain('process_uptime_seconds');
      } else {
        const body = allowed.json();
        expect(body).toHaveProperty('timestamp');
      }
    }
  });
});
