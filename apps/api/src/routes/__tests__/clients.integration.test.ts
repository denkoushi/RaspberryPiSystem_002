import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildServer } from '../../app.js';
import { createAuthHeader, createTestClientDevice, createTestUser } from './helpers.js';

process.env.DATABASE_URL ??= 'postgresql://postgres:postgres@localhost:5432/borrow_return';
process.env.JWT_ACCESS_SECRET ??= 'test-access-secret-1234567890';
process.env.JWT_REFRESH_SECRET ??= 'test-refresh-secret-1234567890';

describe('PUT /api/clients/:id', () => {
  let app: Awaited<ReturnType<typeof buildServer>>;
  let closeServer: (() => Promise<void>) | null = null;
  let adminToken: string;
  let clientId: string;

  beforeAll(async () => {
    app = await buildServer();
    closeServer = async () => {
      await app.close();
    };
  });

  beforeEach(async () => {
    const admin = await createTestUser('ADMIN');
    adminToken = admin.token;
    const client = await createTestClientDevice();
    clientId = client.id;
  });

  afterAll(async () => {
    if (closeServer) {
      await closeServer();
    }
  });

  it('should update defaultMode to PHOTO', async () => {
    const response = await app.inject({
      method: 'PUT',
      url: `/api/clients/${clientId}`,
      headers: { ...createAuthHeader(adminToken), 'Content-Type': 'application/json' },
      payload: {
        defaultMode: 'PHOTO',
      },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.client.defaultMode).toBe('PHOTO');
  });

  it('should update defaultMode to TAG', async () => {
    const response = await app.inject({
      method: 'PUT',
      url: `/api/clients/${clientId}`,
      headers: { ...createAuthHeader(adminToken), 'Content-Type': 'application/json' },
      payload: {
        defaultMode: 'TAG',
      },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.client.defaultMode).toBe('TAG');
  });

  it('should return 404 for non-existent client', async () => {
    const nonExistentId = '00000000-0000-0000-0000-000000000000';
    const response = await app.inject({
      method: 'PUT',
      url: `/api/clients/${nonExistentId}`,
      headers: { ...createAuthHeader(adminToken), 'Content-Type': 'application/json' },
      payload: {
        defaultMode: 'PHOTO',
      },
    });

    expect(response.statusCode).toBe(404);
  });

  it('should return 401 without authentication', async () => {
    const response = await app.inject({
      method: 'PUT',
      url: `/api/clients/${clientId}`,
      headers: { 'Content-Type': 'application/json' },
      payload: {
        defaultMode: 'PHOTO',
      },
    });

    expect(response.statusCode).toBe(401);
  });
});

