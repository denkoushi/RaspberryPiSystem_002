import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildServer } from '../../app.js';
import { cleanupTestData, createAuthHeader, createTestItem, createTestUser } from './helpers.js';

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
    await cleanupTestData();
    const admin = await createTestUser('ADMIN');
    adminToken = admin.token;
  });

  afterAll(async () => {
    await cleanupTestData();
    if (closeServer) {
      await closeServer();
    }
  });

  it('should return 401 without authentication', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/tools/items' });
    expect(response.statusCode).toBe(401);
  });

  it('should return items list with authentication', async () => {
    await createTestItem({ itemCode: 'ITEM001', name: 'Test Item 1' });
    await createTestItem({ itemCode: 'ITEM002', name: 'Test Item 2' });

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
    await cleanupTestData();
    const admin = await createTestUser('ADMIN');
    adminToken = admin.token;
  });

  afterAll(async () => {
    await cleanupTestData();
    if (closeServer) {
      await closeServer();
    }
  });

  it('should create a new item', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/tools/items',
      headers: { ...createAuthHeader(adminToken), 'Content-Type': 'application/json' },
      payload: {
        itemCode: 'ITEM999',
        name: 'New Item',
        nfcTagUid: 'TAG999',
        category: 'Test Category',
      },
    });

    expect(response.statusCode).toBe(201);
    const body = response.json();
    expect(body).toHaveProperty('item');
    expect(body.item.itemCode).toBe('ITEM999');
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

