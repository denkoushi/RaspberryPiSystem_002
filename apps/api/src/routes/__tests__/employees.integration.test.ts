import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildServer } from '../../app.js';
import { cleanupTestData, createAuthHeader, createTestEmployee, createTestUser } from './helpers.js';

process.env.DATABASE_URL ??= 'postgresql://postgres:postgres@localhost:5432/borrow_return';
process.env.JWT_ACCESS_SECRET ??= 'test-access-secret-1234567890';
process.env.JWT_REFRESH_SECRET ??= 'test-refresh-secret-1234567890';

describe('GET /api/tools/employees', () => {
  let app: Awaited<ReturnType<typeof buildServer>>;
  let closeServer: (() => Promise<void>) | null = null;
  let adminToken: string;
  let viewerToken: string;

  beforeAll(async () => {
    app = await buildServer();
    closeServer = async () => {
      await app.close();
    };
  });

  beforeEach(async () => {
    await cleanupTestData();
    const admin = await createTestUser('ADMIN');
    adminToken = admin.token;
    const viewer = await createTestUser('VIEWER');
    viewerToken = viewer.token;
  });

  afterAll(async () => {
    await cleanupTestData();
    if (closeServer) {
      await closeServer();
    }
  });

  it('should return 401 without authentication', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/tools/employees' });
    expect(response.statusCode).toBe(401);
  });

  it('should return employees list with authentication', async () => {
    await createTestEmployee({ employeeCode: 'EMP001', displayName: 'Test Employee 1' });
    await createTestEmployee({ employeeCode: 'EMP002', displayName: 'Test Employee 2' });

    const response = await app.inject({
      method: 'GET',
      url: '/api/tools/employees',
      headers: createAuthHeader(adminToken),
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body).toHaveProperty('employees');
    expect(Array.isArray(body.employees)).toBe(true);
    expect(body.employees.length).toBeGreaterThanOrEqual(2);
  });

  it('should allow VIEWER role to access', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/tools/employees',
      headers: createAuthHeader(viewerToken),
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body).toHaveProperty('employees');
  });

  it('should filter by status', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/tools/employees?status=ACTIVE',
      headers: createAuthHeader(adminToken),
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.employees.every((emp: { status: string }) => emp.status === 'ACTIVE')).toBe(true);
  });
});

describe('POST /api/tools/employees', () => {
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

  it('should create a new employee', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/tools/employees',
      headers: { ...createAuthHeader(adminToken), 'Content-Type': 'application/json' },
      payload: {
        employeeCode: 'EMP999',
        displayName: 'New Employee',
        nfcTagUid: 'TAG999',
        department: 'Test Department',
      },
    });

    expect(response.statusCode).toBe(201);
    const body = response.json();
    expect(body).toHaveProperty('employee');
    expect(body.employee.employeeCode).toBe('EMP999');
    expect(body.employee.displayName).toBe('New Employee');
  });

  it('should return 400 for invalid data', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/tools/employees',
      headers: { ...createAuthHeader(adminToken), 'Content-Type': 'application/json' },
      payload: {
        employeeCode: '', // Invalid: empty string
        displayName: 'Test',
      },
    });

    expect(response.statusCode).toBe(400);
  });
});

