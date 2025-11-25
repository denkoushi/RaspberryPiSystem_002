import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildServer } from '../../app.js';
import { createAuthHeader, createTestItem, createTestUser } from './helpers.js';
import { randomUUID } from 'node:crypto';

process.env.DATABASE_URL ??= 'postgresql://postgres:postgres@localhost:5432/borrow_return';
process.env.JWT_ACCESS_SECRET ??= 'test-access-secret-1234567890';
process.env.JWT_REFRESH_SECRET ??= 'test-refresh-secret-1234567890';

describe('GET /api/tools/items', () => {
  let app: Awaited<ReturnType<typeof buildServer>>;
  let closeServer: (() => Promise<void>) | null = null;
  let adminToken: string;

  beforeAll(async () => {
    app = await buildServer();
    closeServer = async () => {
      await app.close();
    };
  });

  beforeEach(async () => {
    const admin = await createTestUser('ADMIN');
    adminToken = admin.token;
  });

  afterAll(async () => {
    if (closeServer) {
      await closeServer();
    }
  });

  it('should return 401 without authentication', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/tools/items' });
    expect(response.statusCode).toBe(401);
  });

  it('should return items list with authentication', async () => {
    await createTestItem();
    await createTestItem();

    const response = await app.inject({
      method: 'GET',
      url: '/api/tools/items',
      headers: createAuthHeader(adminToken),
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body).toHaveProperty('items');
    expect(Array.isArray(body.items)).toBe(true);
    expect(body.items.length).toBeGreaterThanOrEqual(2);
  });

  it('should filter by status', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/tools/items?status=AVAILABLE',
      headers: createAuthHeader(adminToken),
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.items.every((item: { status: string }) => item.status === 'AVAILABLE')).toBe(true);
  });
});

describe('POST /api/tools/items', () => {
  let app: Awaited<ReturnType<typeof buildServer>>;
  let closeServer: (() => Promise<void>) | null = null;
  let adminToken: string;

  beforeAll(async () => {
    app = await buildServer();
    closeServer = async () => {
      await app.close();
    };
  });

  beforeEach(async () => {
    const admin = await createTestUser('ADMIN');
    adminToken = admin.token;
  });

  afterAll(async () => {
    if (closeServer) {
      await closeServer();
    }
  });

  it('should create a new item', async () => {
    const itemCode = `ITEM-${randomUUID()}`;
    const response = await app.inject({
      method: 'POST',
      url: '/api/tools/items',
      headers: { ...createAuthHeader(adminToken), 'Content-Type': 'application/json' },
      payload: {
        itemCode,
        name: 'New Item',
        nfcTagUid: `TAG-${randomUUID()}`,
        category: 'Test Category',
      },
    });

    expect(response.statusCode).toBe(201);
    const body = response.json();
    expect(body).toHaveProperty('item');
    expect(body.item.itemCode).toBe(itemCode);
    expect(body.item.name).toBe('New Item');
  });

  it('should return 400 for invalid data', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/tools/items',
      headers: { ...createAuthHeader(adminToken), 'Content-Type': 'application/json' },
      payload: {
        itemCode: '', // Invalid: empty string
        name: 'Test',
      },
    });

    expect(response.statusCode).toBe(400);
  });
});

describe('DELETE /api/tools/items/:id', () => {
  let app: Awaited<ReturnType<typeof buildServer>>;
  let closeServer: (() => Promise<void>) | null = null;
  let adminToken: string;
  let managerToken: string;
  let viewerToken: string;

  beforeAll(async () => {
    app = await buildServer();
    closeServer = async () => {
      await app.close();
    };
  });

  beforeEach(async () => {
    const admin = await createTestUser('ADMIN');
    adminToken = admin.token;
    const manager = await createTestUser('MANAGER');
    managerToken = manager.token;
    const viewer = await createTestUser('VIEWER');
    viewerToken = viewer.token;
  });

  afterAll(async () => {
    if (closeServer) {
      await closeServer();
    }
  });

  it('should return 401 without authentication', async () => {
    const item = await createTestItem();
    const response = await app.inject({
      method: 'DELETE',
      url: `/api/tools/items/${item.id}`,
    });

    expect(response.statusCode).toBe(401);
  });

  it('should return 403 for VIEWER role', async () => {
    const item = await createTestItem();
    const response = await app.inject({
      method: 'DELETE',
      url: `/api/tools/items/${item.id}`,
      headers: createAuthHeader(viewerToken),
    });

    expect(response.statusCode).toBe(403);
  });

  it('should delete item with ADMIN role', async () => {
    const item = await createTestItem();
    const response = await app.inject({
      method: 'DELETE',
      url: `/api/tools/items/${item.id}`,
      headers: createAuthHeader(adminToken),
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body).toHaveProperty('item');
    expect(body.item.id).toBe(item.id);

    // 削除されたことを確認
    const getResponse = await app.inject({
      method: 'GET',
      url: `/api/tools/items/${item.id}`,
      headers: createAuthHeader(adminToken),
    });
    expect(getResponse.statusCode).toBe(404);
  });

  it('should delete item with MANAGER role', async () => {
    const item = await createTestItem();
    const response = await app.inject({
      method: 'DELETE',
      url: `/api/tools/items/${item.id}`,
      headers: createAuthHeader(managerToken),
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body).toHaveProperty('item');
    expect(body.item.id).toBe(item.id);
  });

  it('should return 404 for non-existent item', async () => {
    const nonExistentId = randomUUID();
    const response = await app.inject({
      method: 'DELETE',
      url: `/api/tools/items/${nonExistentId}`,
      headers: createAuthHeader(adminToken),
    });

    expect(response.statusCode).toBe(404);
  });
});

