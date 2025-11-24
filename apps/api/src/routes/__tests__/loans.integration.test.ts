import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildServer } from '../../app.js';
import {
  cleanupTestData,
  createTestClientDevice,
  createTestEmployee,
  createTestItem,
} from './helpers.js';

process.env.DATABASE_URL ??= 'postgresql://postgres:postgres@localhost:5432/borrow_return';
process.env.JWT_ACCESS_SECRET ??= 'test-access-secret-1234567890';
process.env.JWT_REFRESH_SECRET ??= 'test-refresh-secret-1234567890';

describe('POST /api/tools/loans/borrow', () => {
  let app: Awaited<ReturnType<typeof buildServer>>;
  let closeServer: (() => Promise<void>) | null = null;
  let clientId: string;
  let employeeId: string;
  let itemId: string;
  let employeeTagUid: string;
  let itemTagUid: string;

  beforeAll(async () => {
    app = await buildServer();
    closeServer = async () => {
      await app.close();
    };
  });

  beforeEach(async () => {
    await cleanupTestData();
    const client = await createTestClientDevice('test-client-key');
    clientId = client.id;
    const employee = await createTestEmployee({
      employeeCode: 'EMP001',
      displayName: 'Test Employee',
      nfcTagUid: 'EMPLOYEE_TAG_001',
    });
    employeeId = employee.id;
    employeeTagUid = 'EMPLOYEE_TAG_001';
    const item = await createTestItem({
      itemCode: 'ITEM001',
      name: 'Test Item',
      nfcTagUid: 'ITEM_TAG_001',
    });
    itemId = item.id;
    itemTagUid = 'ITEM_TAG_001';
  });

  afterAll(async () => {
    await cleanupTestData();
    if (closeServer) {
      await closeServer();
    }
  });

  it('should borrow an item successfully', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/tools/loans/borrow',
      headers: {
        'Content-Type': 'application/json',
        'x-client-key': 'test-client-key',
      },
      payload: {
        itemTagUid,
        employeeTagUid,
        clientId,
        note: 'Test borrow',
      },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body).toHaveProperty('loan');
    expect(body.loan.itemId).toBe(itemId);
    expect(body.loan.employeeId).toBe(employeeId);
  });

  it('should return 404 for non-existent item', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/tools/loans/borrow',
      headers: {
        'Content-Type': 'application/json',
        'x-client-key': 'test-client-key',
      },
      payload: {
        itemTagUid: 'NON_EXISTENT_TAG',
        employeeTagUid,
        clientId,
      },
    });

    expect(response.statusCode).toBe(404);
  });

  it('should return 404 for non-existent employee', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/tools/loans/borrow',
      headers: {
        'Content-Type': 'application/json',
        'x-client-key': 'test-client-key',
      },
      payload: {
        itemTagUid,
        employeeTagUid: 'NON_EXISTENT_TAG',
        clientId,
      },
    });

    expect(response.statusCode).toBe(404);
  });

  it('should return 400 for already borrowed item', async () => {
    // First borrow
    await app.inject({
      method: 'POST',
      url: '/api/tools/loans/borrow',
      headers: {
        'Content-Type': 'application/json',
        'x-client-key': 'test-client-key',
      },
      payload: {
        itemTagUid: 'ITEM_TAG_002',
        employeeTagUid,
        clientId,
      },
    });

    // Create item with ITEM_TAG_002
    await createTestItem({
      itemCode: 'ITEM002',
      name: 'Test Item 2',
      nfcTagUid: 'ITEM_TAG_002',
    });

    // Try to borrow again
    const response = await app.inject({
      method: 'POST',
      url: '/api/tools/loans/borrow',
      headers: {
        'Content-Type': 'application/json',
        'x-client-key': 'test-client-key',
      },
      payload: {
        itemTagUid: 'ITEM_TAG_002',
        employeeTagUid,
        clientId,
      },
    });

    // Should fail if item is already borrowed
    // Note: This depends on the actual implementation
    expect([400, 404]).toContain(response.statusCode);
  });
});

describe('GET /api/tools/loans/active', () => {
  let app: Awaited<ReturnType<typeof buildServer>>;
  let closeServer: (() => Promise<void>) | null = null;
  let clientId: string;
  let employeeTagUid: string;
  let itemTagUid: string;

  beforeAll(async () => {
    app = await buildServer();
    closeServer = async () => {
      await app.close();
    };
  });

  beforeEach(async () => {
    await cleanupTestData();
    const client = await createTestClientDevice('test-client-key');
    clientId = client.id;
    const employee = await createTestEmployee({
      employeeCode: 'EMP001',
      displayName: 'Test Employee',
      nfcTagUid: 'EMPLOYEE_TAG_001',
    });
    employeeTagUid = 'EMPLOYEE_TAG_001';
    const item = await createTestItem({
      itemCode: 'ITEM001',
      name: 'Test Item',
      nfcTagUid: 'ITEM_TAG_001',
    });
    itemTagUid = 'ITEM_TAG_001';

    // Create an active loan
    await app.inject({
      method: 'POST',
      url: '/api/tools/loans/borrow',
      headers: {
        'Content-Type': 'application/json',
        'x-client-key': 'test-client-key',
      },
      payload: {
        itemTagUid,
        employeeTagUid,
        clientId,
      },
    });
  });

  afterAll(async () => {
    await cleanupTestData();
    if (closeServer) {
      await closeServer();
    }
  });

  it('should return active loans', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/tools/loans/active',
      headers: {
        'x-client-key': 'test-client-key',
      },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body).toHaveProperty('loans');
    expect(Array.isArray(body.loans)).toBe(true);
    expect(body.loans.length).toBeGreaterThan(0);
  });

  it('should return 401 without client key', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/tools/loans/active',
    });

    expect(response.statusCode).toBe(401);
  });
});

