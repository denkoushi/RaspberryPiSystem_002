import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildServer } from '../../app.js';
import { createAuthHeader, createTestClientDevice, createTestEmployee, createTestItem, createTestLoan, createTestUser } from './helpers.js';
import { randomUUID } from 'node:crypto';

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
    const admin = await createTestUser('ADMIN');
    adminToken = admin.token;
    const viewer = await createTestUser('VIEWER');
    viewerToken = viewer.token;
  });

  afterAll(async () => {
    if (closeServer) {
      await closeServer();
    }
  });

  it('should return 401 without authentication', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/tools/employees' });
    expect(response.statusCode).toBe(401);
  });

  it('should return employees list with authentication', async () => {
    await createTestEmployee();
    await createTestEmployee();

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
    const admin = await createTestUser('ADMIN');
    adminToken = admin.token;
  });

  afterAll(async () => {
    if (closeServer) {
      await closeServer();
    }
  });

  it('should create a new employee', async () => {
    const employeeCode = `EMP-${randomUUID()}`;
    const response = await app.inject({
      method: 'POST',
      url: '/api/tools/employees',
      headers: { ...createAuthHeader(adminToken), 'Content-Type': 'application/json' },
      payload: {
        employeeCode,
        displayName: 'New Employee',
        nfcTagUid: `TAG-${randomUUID()}`,
        department: 'Test Department',
      },
    });

    expect(response.statusCode).toBe(201);
    const body = response.json();
    expect(body).toHaveProperty('employee');
    expect(body.employee.employeeCode).toBe(employeeCode);
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

describe('DELETE /api/tools/employees/:id', () => {
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
    const employee = await createTestEmployee();
    const response = await app.inject({
      method: 'DELETE',
      url: `/api/tools/employees/${employee.id}`,
    });

    expect(response.statusCode).toBe(401);
  });

  it('should return 403 for VIEWER role', async () => {
    const employee = await createTestEmployee();
    const response = await app.inject({
      method: 'DELETE',
      url: `/api/tools/employees/${employee.id}`,
      headers: createAuthHeader(viewerToken),
    });

    expect(response.statusCode).toBe(403);
  });

  it('should delete employee with ADMIN role', async () => {
    const employee = await createTestEmployee();
    const response = await app.inject({
      method: 'DELETE',
      url: `/api/tools/employees/${employee.id}`,
      headers: createAuthHeader(adminToken),
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body).toHaveProperty('employee');
    expect(body.employee.id).toBe(employee.id);

    // 削除されたことを確認
    const getResponse = await app.inject({
      method: 'GET',
      url: `/api/tools/employees/${employee.id}`,
      headers: createAuthHeader(adminToken),
    });
    expect(getResponse.statusCode).toBe(404);
  });

  it('should delete employee with MANAGER role', async () => {
    const employee = await createTestEmployee();
    const response = await app.inject({
      method: 'DELETE',
      url: `/api/tools/employees/${employee.id}`,
      headers: createAuthHeader(managerToken),
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body).toHaveProperty('employee');
    expect(body.employee.id).toBe(employee.id);
  });

  it('should return 404 for non-existent employee', async () => {
    const nonExistentId = randomUUID();
    const response = await app.inject({
      method: 'DELETE',
      url: `/api/tools/employees/${nonExistentId}`,
      headers: createAuthHeader(adminToken),
    });

    expect(response.statusCode).toBe(404);
  });

  it('should return 400 when employee has active loans', async () => {
    const employee = await createTestEmployee();
    const item = await createTestItem();
    const client = await createTestClientDevice();
    
    // 未返却の貸出記録を作成
    await createTestLoan({
      employeeId: employee.id,
      itemId: item.id,
      clientId: client.id,
      returnedAt: null,
    });

    const response = await app.inject({
      method: 'DELETE',
      url: `/api/tools/employees/${employee.id}`,
      headers: createAuthHeader(adminToken),
    });

    expect(response.statusCode).toBe(400);
    const body = response.json();
    expect(body.message).toContain('未返却の貸出記録');
  });

  it('should delete employee with returned loans', async () => {
    const employee = await createTestEmployee();
    const item = await createTestItem();
    const client = await createTestClientDevice();
    
    // 返却済みの貸出記録を作成
    await createTestLoan({
      employeeId: employee.id,
      itemId: item.id,
      clientId: client.id,
      returnedAt: new Date(),
    });

    const response = await app.inject({
      method: 'DELETE',
      url: `/api/tools/employees/${employee.id}`,
      headers: createAuthHeader(adminToken),
    });

    // 返却済みの貸出記録があっても削除可能
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body).toHaveProperty('employee');
    expect(body.employee.id).toBe(employee.id);
  });
});

