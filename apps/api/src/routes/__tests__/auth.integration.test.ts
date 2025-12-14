import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildServer } from '../../app.js';
import { createTestUser } from './helpers.js';

process.env.DATABASE_URL ??= 'postgresql://postgres:postgres@localhost:5432/borrow_return';
process.env.JWT_ACCESS_SECRET ??= 'test-access-secret-1234567890';
process.env.JWT_REFRESH_SECRET ??= 'test-refresh-secret-1234567890';

describe('POST /api/auth/login', () => {
  let app: Awaited<ReturnType<typeof buildServer>>;
  let closeServer: (() => Promise<void>) | null = null;
  let testUsername: string;
  let testPassword: string;

  beforeAll(async () => {
    app = await buildServer();
    closeServer = async () => {
      await app.close();
    };
  });

  beforeEach(async () => {
    const testUser = await createTestUser('ADMIN', 'test-password-123');
    testUsername = testUser.user.username;
    testPassword = testUser.password;
  });

  afterAll(async () => {
    if (closeServer) {
      await closeServer();
    }
  });

  it('should login successfully with valid credentials', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      headers: { 'Content-Type': 'application/json' },
      payload: {
        username: testUsername,
        password: testPassword,
      },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body).toHaveProperty('accessToken');
    expect(body).toHaveProperty('refreshToken');
    expect(body).toHaveProperty('user');
    expect(body.user.username).toBe(testUsername);
    expect(body.user.role).toBe('ADMIN');
  });

  it('should return 401 with invalid password', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      headers: { 'Content-Type': 'application/json' },
      payload: {
        username: testUsername,
        password: 'wrong-password',
      },
    });

    expect(response.statusCode).toBe(401);
    const body = response.json();
    expect(body.message).toContain('ユーザー名またはパスワードが違います');
  });

  it('should return 401 with non-existent username', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      headers: { 'Content-Type': 'application/json' },
      payload: {
        username: 'non-existent-user',
        password: 'any-password',
      },
    });

    expect(response.statusCode).toBe(401);
  });

  it('should return 400 for invalid request body', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      headers: { 'Content-Type': 'application/json' },
      payload: {
        username: '', // Invalid: empty string
      },
    });

    expect(response.statusCode).toBe(400);
  });

  it('should accept rememberMe parameter and return tokens', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      headers: { 'Content-Type': 'application/json' },
      payload: {
        username: testUsername,
        password: testPassword,
        rememberMe: true,
      },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body).toHaveProperty('accessToken');
    expect(body).toHaveProperty('refreshToken');
    expect(body).toHaveProperty('user');
  });

  it('should work without rememberMe parameter (backward compatibility)', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      headers: { 'Content-Type': 'application/json' },
      payload: {
        username: testUsername,
        password: testPassword,
        // rememberMe not provided
      },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body).toHaveProperty('accessToken');
  });
});

describe('POST /api/auth/refresh', () => {
  let app: Awaited<ReturnType<typeof buildServer>>;
  let closeServer: (() => Promise<void>) | null = null;
  let refreshToken: string;

  beforeAll(async () => {
    app = await buildServer();
    closeServer = async () => {
      await app.close();
    };
  });

  beforeEach(async () => {
    const testUser = await createTestUser('ADMIN', 'test-password-123');

    // Login to get refresh token
    const loginResponse = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      headers: { 'Content-Type': 'application/json' },
      payload: {
        username: testUser.user.username,
        password: testUser.password,
      },
    });
    const loginBody = loginResponse.json();
    refreshToken = loginBody.refreshToken;
  });

  afterAll(async () => {
    if (closeServer) {
      await closeServer();
    }
  });

  it('should refresh access token successfully', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/auth/refresh',
      headers: { 'Content-Type': 'application/json' },
      payload: {
        refreshToken,
      },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body).toHaveProperty('accessToken');
    expect(body).toHaveProperty('refreshToken');
  });

  it('should return 401 with invalid refresh token', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/auth/refresh',
      headers: { 'Content-Type': 'application/json' },
      payload: {
        refreshToken: 'invalid-token',
      },
    });

    expect(response.statusCode).toBe(401);
  });
});

describe('POST /api/auth/users/:id/role - Role Change with Audit', () => {
  let app: Awaited<ReturnType<typeof buildServer>>;
  let closeServer: (() => Promise<void>) | null = null;
  let adminToken: string;
  let targetUserId: string;

  beforeAll(async () => {
    app = await buildServer();
    closeServer = async () => {
      await app.close();
    };
  });

  beforeEach(async () => {
    // Create admin user and get token
    const adminUser = await createTestUser('ADMIN', 'admin-password');
    const loginResponse = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      headers: { 'Content-Type': 'application/json' },
      payload: { username: adminUser.user.username, password: adminUser.password },
    });
    adminToken = loginResponse.json().accessToken;

    // Create target user to change role
    const targetUser = await createTestUser('VIEWER', 'target-password');
    targetUserId = targetUser.user.id;
  });

  afterAll(async () => {
    if (closeServer) {
      await closeServer();
    }
  });

  it('should change user role and create audit log', async () => {
    const response = await app.inject({
      method: 'POST',
      url: `/api/auth/users/${targetUserId}/role`,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`,
      },
      payload: { role: 'MANAGER' },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.user.role).toBe('MANAGER');
  });

  it('should return audit logs', async () => {
    // First change a role to generate audit log
    await app.inject({
      method: 'POST',
      url: `/api/auth/users/${targetUserId}/role`,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`,
      },
      payload: { role: 'MANAGER' },
    });

    // Get audit logs
    const response = await app.inject({
      method: 'GET',
      url: '/api/auth/role-audit',
      headers: { Authorization: `Bearer ${adminToken}` },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body).toHaveProperty('logs');
    expect(Array.isArray(body.logs)).toBe(true);
    expect(body.logs.length).toBeGreaterThan(0);
    expect(body.logs[0]).toHaveProperty('fromRole');
    expect(body.logs[0]).toHaveProperty('toRole');
  });

  it('should return 401 without auth token', async () => {
    const response = await app.inject({
      method: 'POST',
      url: `/api/auth/users/${targetUserId}/role`,
      headers: { 'Content-Type': 'application/json' },
      payload: { role: 'MANAGER' },
    });

    expect(response.statusCode).toBe(401);
  });

  it('should return 404 for non-existent user', async () => {
    const fakeId = '00000000-0000-0000-0000-000000000000';
    const response = await app.inject({
      method: 'POST',
      url: `/api/auth/users/${fakeId}/role`,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`,
      },
      payload: { role: 'MANAGER' },
    });

    expect(response.statusCode).toBe(404);
  });
});

