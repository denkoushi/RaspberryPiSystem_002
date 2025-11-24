import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildServer } from '../../app.js';
import { prisma } from '../../lib/prisma.js';
import bcrypt from 'bcryptjs';
import { cleanupTestData } from './helpers.js';

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
    await cleanupTestData();
    testUsername = `test-user-${Date.now()}`;
    testPassword = 'test-password-123';
    const passwordHash = await bcrypt.hash(testPassword, 10);
    await prisma.user.create({
      data: {
        username: testUsername,
        passwordHash,
        role: 'ADMIN',
        status: 'ACTIVE',
      },
    });
  });

  afterAll(async () => {
    await cleanupTestData();
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
});

describe('POST /api/auth/refresh', () => {
  let app: Awaited<ReturnType<typeof buildServer>>;
  let closeServer: (() => Promise<void>) | null = null;
  let refreshToken: string;
  let refreshTestUsername: string;
  let refreshTestPassword: string;

  beforeAll(async () => {
    app = await buildServer();
    closeServer = async () => {
      await app.close();
    };
    await cleanupTestData();
    refreshTestUsername = `test-user-refresh-${Date.now()}`;
    refreshTestPassword = 'test-password-123';
    const passwordHash = await bcrypt.hash(refreshTestPassword, 10);
    await prisma.user.create({
      data: {
        username: refreshTestUsername,
        passwordHash,
        role: 'ADMIN',
        status: 'ACTIVE',
      },
    });

    // Login to get refresh token
    const loginResponse = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      headers: { 'Content-Type': 'application/json' },
      payload: {
        username: refreshTestUsername,
        password: refreshTestPassword,
      },
    });
    const loginBody = loginResponse.json();
    refreshToken = loginBody.refreshToken;
  });

  afterAll(async () => {
    await cleanupTestData();
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

