import type { User } from '@prisma/client';
import bcrypt from 'bcryptjs';
import Fastify from 'fastify';
import jwt from 'jsonwebtoken';
import { authenticator } from 'otplib';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  env: {
    ADMIN_MFA_REQUIRED: false,
    JWT_ACCESS_SECRET: 'test-access-mfa-secret',
    JWT_REFRESH_SECRET: 'test-refresh-mfa-secret',
    TOKEN_EXPIRES_IN: '15m',
    REFRESH_TOKEN_EXPIRES_IN: '7d'
  },
  findUnique: vi.fn(), update: vi.fn(), findMany: vi.fn()
}));
vi.mock('../../config/env.js', () => ({ env: mocks.env }));
vi.mock('../../lib/prisma.js', () => ({ prisma: {
  user: { findUnique: mocks.findUnique, update: mocks.update },
  roleAuditLog: { findMany: mocks.findMany }
} }));
vi.mock('../../services/auth/auth-role-admin.service.js', () => ({ AuthRoleAdminService: class {} }));

import { authenticate, authorizeRoles } from '../../lib/auth.js';
import { registerErrorHandler } from '../../plugins/error-handler.js';
import { registerAuthRoutes } from '../auth.js';

let app: ReturnType<typeof Fastify>;
let user: User;
const password = 'test-password';
const headers = (token: string) => ({ authorization: `Bearer ${token}` });
const login = () => app.inject({ method: 'POST', url: '/api/auth/login', payload: { username: user.username, password } });

beforeEach(async () => {
  vi.clearAllMocks();
  mocks.env.ADMIN_MFA_REQUIRED = false;
  user = {
    id: 'test-user', username: 'admin', role: 'ADMIN', status: 'ACTIVE',
    passwordHash: await bcrypt.hash(password, 4), mfaEnabled: false,
    totpSecret: null, mfaBackupCodes: []
  } as User;
  mocks.findUnique.mockImplementation(async () => user);
  mocks.update.mockImplementation(async ({ data }: { data: Partial<User> }) => {
    user = { ...user, ...data };
    return user;
  });
  mocks.findMany.mockResolvedValue([]);
  app = Fastify();
  registerErrorHandler(app);
  await app.register(registerAuthRoutes, { prefix: '/api' });
  app.get('/api/admin-probe', { preHandler: authorizeRoles('ADMIN', 'MANAGER') }, async () => ({ ok: true }));
  app.get('/api/user-probe', { preHandler: authenticate }, async () => ({ ok: true }));
});
afterEach(async () => { await app.close(); });

function expectMfaError(response: Awaited<ReturnType<typeof app.inject>>, code = 'MFA_SETUP_REQUIRED') {
  expect(response.statusCode).toBe(403);
  expect(response.json().errorCode).toBe(code);
}

async function activate(token: string) {
  const initiation = await app.inject({ method: 'POST', url: '/api/auth/mfa/initiate', headers: headers(token) });
  expect(initiation.statusCode).toBe(200);
  const setup = initiation.json();
  const response = await app.inject({
    method: 'POST', url: '/api/auth/mfa/activate', headers: headers(token),
    payload: { secret: setup.secret, code: authenticator.generate(setup.secret), backupCodes: setup.backupCodes }
  });
  expect(response.statusCode).toBe(200);
  expect(response.json().backupCodes).toEqual(setup.backupCodes);
  return response.json();
}

describe('admin MFA enforcement', () => {
  it('keeps unconfigured ADMIN access and disabling available when off', async () => {
    const session = (await login()).json();
    expect(session.user).toMatchObject({ mfaSetupRequired: false, mfaRequired: false });
    expect(jwt.verify(session.accessToken, mocks.env.JWT_ACCESS_SECRET)).toMatchObject({ mfaEnabled: false });
    expect(jwt.verify(session.refreshToken, mocks.env.JWT_REFRESH_SECRET)).toMatchObject({ mfaEnabled: false });
    expect((await app.inject({ url: '/api/auth/role-audit', headers: headers(session.accessToken) })).statusCode).toBe(200);
    const enabled = await activate(session.accessToken);
    const disabled = await app.inject({ method: 'POST', url: '/api/auth/mfa/disable', headers: headers(enabled.accessToken), payload: { password } });
    expect(disabled.statusCode).toBe(200);
    expect(user.mfaEnabled).toBe(false);
  });

  it.each(['ADMIN', 'MANAGER'] as const)('blocks %s until setup and accepts the activation tokens without login', async (role) => {
    mocks.env.ADMIN_MFA_REQUIRED = true;
    user.role = role;
    const session = (await login()).json();
    expect(session.user).toMatchObject({ mfaSetupRequired: true, mfaRequired: true });
    for (const url of ['/api/admin-probe', '/api/user-probe', '/api/auth/role-audit']) {
      expectMfaError(await app.inject({ url, headers: headers(session.accessToken) }));
    }
    const enabled = await activate(session.accessToken);
    expect(enabled.user).toMatchObject({ mfaEnabled: true, mfaSetupRequired: false, mfaRequired: true });
    expect(jwt.verify(enabled.accessToken, mocks.env.JWT_ACCESS_SECRET)).toMatchObject({ mfaEnabled: true });
    expect(jwt.verify(enabled.refreshToken, mocks.env.JWT_REFRESH_SECRET)).toMatchObject({ mfaEnabled: true });
    expect((await app.inject({ url: '/api/admin-probe', headers: headers(enabled.accessToken) })).statusCode).toBe(200);
    // Issued tokens keep their original MFA state even after DB activation.
    expectMfaError(await app.inject({ url: '/api/user-probe', headers: headers(session.accessToken) }));
    const originalSecret = user.totpSecret;
    await activate(enabled.accessToken);
    expect(user.mfaEnabled).toBe(true);
    expect(user.totpSecret).not.toBe(originalSecret);
  });

  it.each(['ADMIN', 'MANAGER'] as const)('rejects legacy %s tokens without an MFA claim', async (role) => {
    mocks.env.ADMIN_MFA_REQUIRED = true;
    user.mfaEnabled = true;
    const token = jwt.sign({ sub: user.id, username: user.username, role }, mocks.env.JWT_ACCESS_SECRET);
    expectMfaError(await app.inject({ url: '/api/user-probe', headers: headers(token) }));
    expect(mocks.findUnique).not.toHaveBeenCalled();
  });

  it.each([undefined, false, 'true', 1])('requires the boolean true claim, rejecting %s', async (mfaEnabled) => {
    mocks.env.ADMIN_MFA_REQUIRED = true;
    const token = jwt.sign({ sub: user.id, username: user.username, role: user.role, mfaEnabled }, mocks.env.JWT_ACCESS_SECRET);
    expectMfaError(await app.inject({ url: '/api/user-probe', headers: headers(token) }));
    expectMfaError(await app.inject({ url: '/api/user-probe?next=/api/auth/mfa/initiate', headers: headers(token) }));
  });

  it('does not affect VIEWER login, refresh or legacy tokens', async () => {
    mocks.env.ADMIN_MFA_REQUIRED = true;
    user.role = 'VIEWER';
    const session = (await login()).json();
    expect(session.user).toMatchObject({ mfaSetupRequired: false, mfaRequired: false });
    const legacy = jwt.sign({ sub: user.id, username: user.username, role: user.role }, mocks.env.JWT_ACCESS_SECRET);
    expect((await app.inject({ url: '/api/user-probe', headers: headers(legacy) })).statusCode).toBe(200);
    expect((await app.inject({ method: 'POST', url: '/api/auth/refresh', payload: { refreshToken: session.refreshToken } })).json().user.mfaSetupRequired).toBe(false);
    expect((await app.inject({ method: 'POST', url: '/api/auth/mfa/initiate', headers: headers(legacy) })).json().errorCode).toBe('AUTH_INSUFFICIENT_PERMISSIONS');
  });

  it.each(['ADMIN', 'MANAGER'] as const)('forbids %s disabling when required', async (role) => {
    mocks.env.ADMIN_MFA_REQUIRED = true;
    user.role = role;
    const session = (await login()).json();
    const enabled = await activate(session.accessToken);
    expectMfaError(await app.inject({ method: 'POST', url: '/api/auth/mfa/disable', headers: headers(enabled.accessToken), payload: { password } }), 'MFA_DISABLE_NOT_ALLOWED');
    expect(user.mfaEnabled).toBe(true);
  });

  it.each([false, true])('reports setup policy in refresh when required=%s', async (required) => {
    mocks.env.ADMIN_MFA_REQUIRED = required;
    const session = (await login()).json();
    const response = await app.inject({ method: 'POST', url: '/api/auth/refresh', payload: { refreshToken: session.refreshToken } });
    expect(response.statusCode).toBe(200);
    expect(response.json().user.mfaSetupRequired).toBe(required);
    const enabled = await activate(session.accessToken);
    const refreshed = await app.inject({ method: 'POST', url: '/api/auth/refresh', payload: { refreshToken: enabled.refreshToken } });
    expect(refreshed.statusCode).toBe(200);
    expect(refreshed.json().user.mfaSetupRequired).toBe(false);
    const code = authenticator.generate(user.totpSecret!);
    const relogin = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { username: user.username, password, totpCode: code } });
    expect(relogin.statusCode).toBe(200);
    expect(relogin.json().user.mfaSetupRequired).toBe(false);
    expect((await login()).statusCode).toBe(401);
  });

  it('preserves invalid-token errors for setup endpoints', async () => {
    mocks.env.ADMIN_MFA_REQUIRED = true;
    for (const url of ['/api/auth/mfa/initiate', '/api/auth/mfa/activate']) {
      expect((await app.inject({ method: 'POST', url, headers: headers('invalid') })).statusCode).toBe(401);
    }
  });
});
