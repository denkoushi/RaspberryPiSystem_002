import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import jwt from 'jsonwebtoken';
import { buildServer } from '../../app.js';

process.env.DATABASE_URL ??= 'postgresql://postgres:postgres@localhost:5432/borrow_return';
process.env.JWT_ACCESS_SECRET ??= 'test-access-secret-1234567890';
process.env.JWT_REFRESH_SECRET ??= 'test-refresh-secret-1234567890';

function authHeader(role: 'ADMIN' | 'MANAGER' | 'VIEWER') {
  const token = jwt.sign(
    { sub: `test-${role.toLowerCase()}`, username: `test-${role.toLowerCase()}`, role },
    process.env.JWT_ACCESS_SECRET!,
  );
  return { authorization: `Bearer ${token}` };
}

describe('GET /api/system/network-mode', () => {
  let closeServer: (() => Promise<void>) | null = null;

  beforeAll(() => {
    process.env.NETWORK_STATUS_OVERRIDE = 'local_network_only';
    process.env.NETWORK_MODE = 'local';
  });

  afterAll(async () => {
    delete process.env.NETWORK_STATUS_OVERRIDE;
  });

  afterEach(async () => {
    if (closeServer) {
      await closeServer();
      closeServer = null;
    }
  });

  it('requires ADMIN or MANAGER', async () => {
    const app = await buildServer();
    closeServer = async () => {
      await app.close();
    };

    const unauth = await app.inject({ method: 'GET', url: '/api/system/network-mode' });
    expect(unauth.statusCode).toBe(401);

    const viewer = await app.inject({
      method: 'GET',
      url: '/api/system/network-mode',
      headers: authHeader('VIEWER'),
    });
    expect(viewer.statusCode).toBe(403);
  });

  it.each(['ADMIN', 'MANAGER'] as const)('returns network mode information for %s', async (role) => {
    const app = await buildServer();
    closeServer = async () => {
      await app.close();
    };

    const response = await app.inject({
      method: 'GET',
      url: '/api/system/network-mode',
      headers: authHeader(role),
    });
    expect(response.statusCode).toBe(200);

    const body = response.json();
    expect(body).toMatchObject({
      detectedMode: 'local',
      configuredMode: 'local',
      status: 'local_network_only'
    });
    expect(body).toHaveProperty('checkedAt');
    expect(body).toHaveProperty('latencyMs');
    expect(body).toHaveProperty('source');
  });
});
