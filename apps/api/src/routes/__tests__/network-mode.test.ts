import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildServer } from '../../app.js';

process.env.DATABASE_URL ??= 'postgresql://postgres:postgres@localhost:5432/borrow_return';
process.env.JWT_ACCESS_SECRET ??= 'test-access-secret-1234567890';
process.env.JWT_REFRESH_SECRET ??= 'test-refresh-secret-1234567890';

describe('GET /api/system/network-mode', () => {
  let closeServer: (() => Promise<void>) | null = null;

  beforeAll(() => {
    process.env.NETWORK_STATUS_OVERRIDE = 'local_network_only';
    process.env.NETWORK_MODE = 'local';
  });

  afterAll(async () => {
    if (closeServer) {
      await closeServer();
    }
    delete process.env.NETWORK_STATUS_OVERRIDE;
  });

  it('returns network mode information', async () => {
    const app = await buildServer();
    closeServer = async () => {
      await app.close();
    };

    const response = await app.inject({ method: 'GET', url: '/api/system/network-mode' });
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

