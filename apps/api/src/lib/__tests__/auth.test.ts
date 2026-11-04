import type { User } from '@prisma/client';
import type { FastifyReply, FastifyRequest } from 'fastify';
import jwt from 'jsonwebtoken';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  env: {
    ADMIN_MFA_REQUIRED: false as boolean,
    JWT_ACCESS_SECRET: 'unit-access-secret',
    JWT_REFRESH_SECRET: 'unit-refresh-secret',
    TOKEN_EXPIRES_IN: '15m',
    REFRESH_TOKEN_EXPIRES_IN: '7d'
  }
}));
vi.mock('../../config/env.js', () => ({ env: mocks.env }));

import {
  authenticate,
  authorizeRoles,
  isAdminMfaRequired,
  requireDueManagementToken,
  signAccessToken,
  signDueManagementToken,
  signRefreshToken
} from '../auth.js';
import { ApiError } from '../errors.js';

const ACCESS = 'unit-access-secret';
const FIXED_NOW = new Date('2026-04-01T09:00:00.000Z');

function makeUser(overrides: Partial<User> = {}): User {
  return {
    id: 'user-1',
    username: 'alice',
    role: 'VIEWER',
    mfaEnabled: false,
    ...overrides
  } as User;
}

type FakeRequest = FastifyRequest & { user?: { id: string; username: string; role: User['role'] } };

function makeRequest(authorization?: string, opts: { method?: string; url?: string } = {}): FakeRequest {
  return {
    headers: authorization === undefined ? {} : { authorization },
    method: opts.method ?? 'GET',
    routeOptions: { url: opts.url ?? '/api/tools/items' }
  } as unknown as FakeRequest;
}

function makeReply() {
  const reply = { code: vi.fn() };
  reply.code.mockReturnValue(reply);
  return reply as unknown as FastifyReply & { code: ReturnType<typeof vi.fn> };
}

async function captureError(promise: Promise<unknown>): Promise<ApiError> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof ApiError) return error;
    throw error;
  }
  throw new Error('expected ApiError to be thrown');
}

function captureSyncError(fn: () => void): ApiError {
  try {
    fn();
  } catch (error) {
    if (error instanceof ApiError) return error;
    throw error;
  }
  throw new Error('expected ApiError to be thrown');
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(FIXED_NOW);
  mocks.env.ADMIN_MFA_REQUIRED = false;
});

afterEach(() => {
  vi.useRealTimers();
});

describe('signAccessToken / signRefreshToken', () => {
  it('embeds user claims and signs access/refresh tokens with different secrets and lifetimes', () => {
    const user = makeUser({ id: 'u-9', username: 'bob', role: 'MANAGER', mfaEnabled: true });
    const access = signAccessToken(user);
    const refresh = signRefreshToken(user);

    const accessPayload = jwt.verify(access, ACCESS) as jwt.JwtPayload;
    expect(accessPayload).toMatchObject({ sub: 'u-9', username: 'bob', role: 'MANAGER', mfaEnabled: true });
    expect(accessPayload.exp! - accessPayload.iat!).toBe(15 * 60);

    const refreshPayload = jwt.verify(refresh, 'unit-refresh-secret') as jwt.JwtPayload;
    expect(refreshPayload.exp! - refreshPayload.iat!).toBe(7 * 24 * 60 * 60);

    // Tokens must not be interchangeable between the two secrets.
    expect(() => jwt.verify(access, 'unit-refresh-secret')).toThrow(jwt.JsonWebTokenError);
    expect(() => jwt.verify(refresh, ACCESS)).toThrow(jwt.JsonWebTokenError);
  });
});

describe('isAdminMfaRequired', () => {
  it('is false for every role when the flag is off', () => {
    mocks.env.ADMIN_MFA_REQUIRED = false;
    expect(isAdminMfaRequired('ADMIN')).toBe(false);
    expect(isAdminMfaRequired('MANAGER')).toBe(false);
    expect(isAdminMfaRequired('VIEWER')).toBe(false);
  });

  it('requires MFA only for ADMIN and MANAGER when the flag is on', () => {
    mocks.env.ADMIN_MFA_REQUIRED = true;
    expect(isAdminMfaRequired('ADMIN')).toBe(true);
    expect(isAdminMfaRequired('MANAGER')).toBe(true);
    expect(isAdminMfaRequired('VIEWER')).toBe(false);
  });
});

describe('authenticate', () => {
  it('sets request.user from a valid Bearer access token', async () => {
    const token = signAccessToken(makeUser({ id: 'u-1', username: 'alice', role: 'ADMIN' }));
    const request = makeRequest(`Bearer ${token}`);
    await authenticate(request, makeReply());
    expect(request.user).toEqual({ id: 'u-1', username: 'alice', role: 'ADMIN' });
  });

  it('rejects a missing Authorization header with AUTH_TOKEN_REQUIRED', async () => {
    const request = makeRequest(undefined);
    const error = await captureError(authenticate(request, makeReply()));
    expect(error.statusCode).toBe(401);
    expect(error.code).toBe('AUTH_TOKEN_REQUIRED');
    expect(request.user).toBeUndefined();
  });

  it.each([
    ['scheme only', 'Bearer'],
    ['token without scheme', 'just-a-token'],
    ['garbage token', 'Bearer not.a.jwt'],
    ['empty bearer', 'Bearer ']
  ])('rejects a malformed header (%s) with AUTH_TOKEN_INVALID and sets 401 on reply', async (_label, header) => {
    const reply = makeReply();
    const request = makeRequest(header);
    const error = await captureError(authenticate(request, reply));
    expect(error.statusCode).toBe(401);
    expect(error.code).toBe('AUTH_TOKEN_INVALID');
    expect(reply.code).toHaveBeenCalledWith(401);
    expect(request.user).toBeUndefined();
  });

  it('rejects a token signed with a different secret', async () => {
    const forged = jwt.sign({ sub: 'u-1', username: 'alice', role: 'ADMIN' }, 'attacker-secret');
    const error = await captureError(authenticate(makeRequest(`Bearer ${forged}`), makeReply()));
    expect(error.code).toBe('AUTH_TOKEN_INVALID');
  });

  it('rejects a refresh token presented as an access token', async () => {
    const refresh = signRefreshToken(makeUser({ role: 'ADMIN' }));
    const error = await captureError(authenticate(makeRequest(`Bearer ${refresh}`), makeReply()));
    expect(error.code).toBe('AUTH_TOKEN_INVALID');
  });

  it('accepts a token right before expiry and rejects it after expiry', async () => {
    const token = signAccessToken(makeUser());
    vi.setSystemTime(new Date(FIXED_NOW.getTime() + 15 * 60 * 1000 - 1000));
    await expect(authenticate(makeRequest(`Bearer ${token}`), makeReply())).resolves.toBeUndefined();

    vi.setSystemTime(new Date(FIXED_NOW.getTime() + 15 * 60 * 1000 + 1000));
    const error = await captureError(authenticate(makeRequest(`Bearer ${token}`), makeReply()));
    expect(error.statusCode).toBe(401);
    expect(error.code).toBe('AUTH_TOKEN_INVALID');
  });

  it('rejects an unsigned (alg=none) token even if claims look valid', async () => {
    const unsigned = jwt.sign({ sub: 'u-1', username: 'alice', role: 'ADMIN' }, '', { algorithm: 'none' });
    const error = await captureError(authenticate(makeRequest(`Bearer ${unsigned}`), makeReply()));
    expect(error.code).toBe('AUTH_TOKEN_INVALID');
  });

  it.each([
    ['missing sub', { username: 'alice', role: 'ADMIN' }],
    ['empty sub', { sub: '', username: 'alice', role: 'ADMIN' }],
    ['numeric sub', { sub: 123, username: 'alice', role: 'ADMIN' }],
    ['missing username', { sub: 'u-1', role: 'ADMIN' }],
    ['empty username', { sub: 'u-1', username: '', role: 'ADMIN' }],
    ['missing role', { sub: 'u-1', username: 'alice' }],
    ['due-management purpose token', { purpose: 'due-management', clientDeviceId: 'dev-1' }]
  ])('rejects a correctly signed token with invalid user claims (%s)', async (_label, claims) => {
    const token = jwt.sign(claims, ACCESS);
    const error = await captureError(authenticate(makeRequest(`Bearer ${token}`), makeReply()));
    expect(error.statusCode).toBe(401);
    expect(error.code).toBe('AUTH_TOKEN_INVALID');
  });

  it('does not verify the Authorization scheme (any first word is accepted)', async () => {
    // NOTE: possible bug: the scheme is ignored; "Basic <jwt>" authenticates the same as "Bearer <jwt>".
    const token = signAccessToken(makeUser({ role: 'VIEWER' }));
    const request = makeRequest(`Basic ${token}`);
    await authenticate(request, makeReply());
    expect(request.user?.role).toBe('VIEWER');
  });

  describe('when ADMIN_MFA_REQUIRED is on', () => {
    beforeEach(() => {
      mocks.env.ADMIN_MFA_REQUIRED = true;
    });

    it('blocks ADMIN/MANAGER tokens without mfaEnabled with MFA_SETUP_REQUIRED', async () => {
      for (const role of ['ADMIN', 'MANAGER'] as const) {
        const token = signAccessToken(makeUser({ role, mfaEnabled: false }));
        const request = makeRequest(`Bearer ${token}`);
        const error = await captureError(authenticate(request, makeReply()));
        expect(error.statusCode).toBe(403);
        expect(error.code).toBe('MFA_SETUP_REQUIRED');
        expect(request.user).toBeUndefined();
      }
    });

    it('blocks legacy ADMIN tokens that carry no mfaEnabled claim', async () => {
      const legacy = jwt.sign({ sub: 'u-1', username: 'alice', role: 'ADMIN' }, ACCESS);
      const error = await captureError(authenticate(makeRequest(`Bearer ${legacy}`), makeReply()));
      expect(error.code).toBe('MFA_SETUP_REQUIRED');
    });

    it('allows ADMIN tokens without MFA only on POST to the MFA setup routes', async () => {
      const token = signAccessToken(makeUser({ role: 'ADMIN', mfaEnabled: false }));
      for (const url of ['/api/auth/mfa/initiate', '/api/auth/mfa/activate']) {
        const request = makeRequest(`Bearer ${token}`, { method: 'POST', url });
        await authenticate(request, makeReply());
        expect(request.user?.role).toBe('ADMIN');
      }

      const getSetup = makeRequest(`Bearer ${token}`, { method: 'GET', url: '/api/auth/mfa/initiate' });
      expect((await captureError(authenticate(getSetup, makeReply()))).code).toBe('MFA_SETUP_REQUIRED');

      const disable = makeRequest(`Bearer ${token}`, { method: 'POST', url: '/api/auth/mfa/disable' });
      expect((await captureError(authenticate(disable, makeReply()))).code).toBe('MFA_SETUP_REQUIRED');
    });

    it('lets VIEWER without MFA and ADMIN with MFA through', async () => {
      const viewer = makeRequest(`Bearer ${signAccessToken(makeUser({ role: 'VIEWER', mfaEnabled: false }))}`);
      await authenticate(viewer, makeReply());
      expect(viewer.user?.role).toBe('VIEWER');

      const admin = makeRequest(`Bearer ${signAccessToken(makeUser({ role: 'ADMIN', mfaEnabled: true }))}`);
      await authenticate(admin, makeReply());
      expect(admin.user?.role).toBe('ADMIN');
    });
  });
});

describe('authorizeRoles', () => {
  const tokenFor = (role: User['role']) => `Bearer ${signAccessToken(makeUser({ role }))}`;

  it('allows only the listed roles', async () => {
    const guard = authorizeRoles('ADMIN', 'MANAGER');
    for (const role of ['ADMIN', 'MANAGER'] as const) {
      const request = makeRequest(tokenFor(role));
      await guard(request, makeReply());
      expect(request.user?.role).toBe(role);
    }

    const error = await captureError(guard(makeRequest(tokenFor('VIEWER')), makeReply()));
    expect(error.statusCode).toBe(403);
    expect(error.code).toBe('AUTH_INSUFFICIENT_PERMISSIONS');
  });

  it('denies MANAGER on an ADMIN-only guard', async () => {
    const error = await captureError(authorizeRoles('ADMIN')(makeRequest(tokenFor('MANAGER')), makeReply()));
    expect(error.statusCode).toBe(403);
    expect(error.code).toBe('AUTH_INSUFFICIENT_PERMISSIONS');
  });

  it('denies every role when called with no roles', async () => {
    const error = await captureError(authorizeRoles()(makeRequest(tokenFor('ADMIN')), makeReply()));
    expect(error.code).toBe('AUTH_INSUFFICIENT_PERMISSIONS');
  });

  it('rejects a token whose role claim is not a known role', async () => {
    const token = jwt.sign({ sub: 'u-1', username: 'alice', role: 'SUPERUSER' }, ACCESS);
    const error = await captureError(authorizeRoles('ADMIN')(makeRequest(`Bearer ${token}`), makeReply()));
    expect(error.statusCode).toBe(403);
    expect(error.code).toBe('AUTH_INSUFFICIENT_PERMISSIONS');
  });

  it('reports authentication failure (401) before authorization', async () => {
    const error = await captureError(authorizeRoles('VIEWER')(makeRequest(undefined), makeReply()));
    expect(error.statusCode).toBe(401);
    expect(error.code).toBe('AUTH_TOKEN_REQUIRED');
  });
});

describe('signDueManagementToken / requireDueManagementToken', () => {
  it('refuses to sign without a client device id', () => {
    for (const id of [undefined, '']) {
      const error = captureSyncError(() => signDueManagementToken(id));
      expect(error.statusCode).toBe(403);
      expect(error.code).toBe('DUE_MANAGEMENT_TOKEN_INVALID');
    }
  });

  it('accepts a freshly signed token for the same device', () => {
    const token = signDueManagementToken('dev-1');
    expect(() => requireDueManagementToken(token, 'dev-1')).not.toThrow();
    const payload = jwt.verify(token, ACCESS) as jwt.JwtPayload;
    expect(payload.exp! - payload.iat!).toBe(12 * 60 * 60);
  });

  it.each([undefined, null, ''])('requires a token (%s)', (raw) => {
    const error = captureSyncError(() => requireDueManagementToken(raw, 'dev-1'));
    expect(error.code).toBe('DUE_MANAGEMENT_TOKEN_REQUIRED');
  });

  it('rejects a non-string header value (e.g. repeated header array)', () => {
    const token = signDueManagementToken('dev-1');
    const error = captureSyncError(() => requireDueManagementToken([token], 'dev-1'));
    expect(error.code).toBe('DUE_MANAGEMENT_TOKEN_INVALID');
  });

  it('distinguishes an expired token from an invalid one', () => {
    const token = signDueManagementToken('dev-1');
    vi.setSystemTime(new Date(FIXED_NOW.getTime() + 12 * 60 * 60 * 1000 + 1000));
    const error = captureSyncError(() => requireDueManagementToken(token, 'dev-1'));
    expect(error.statusCode).toBe(403);
    expect(error.code).toBe('DUE_MANAGEMENT_TOKEN_EXPIRED');
  });

  it('rejects a token signed with another secret or algorithm', () => {
    const wrongSecret = jwt.sign({ purpose: 'due-management', clientDeviceId: 'dev-1' }, 'other', { expiresIn: '1h' });
    expect(captureSyncError(() => requireDueManagementToken(wrongSecret, 'dev-1')).code).toBe('DUE_MANAGEMENT_TOKEN_INVALID');

    const hs512 = jwt.sign({ purpose: 'due-management', clientDeviceId: 'dev-1' }, ACCESS, { algorithm: 'HS512', expiresIn: '1h' });
    expect(captureSyncError(() => requireDueManagementToken(hs512, 'dev-1')).code).toBe('DUE_MANAGEMENT_TOKEN_INVALID');
  });

  it('rejects a user access token (has sub/role) used as a due-management token', () => {
    const access = signAccessToken(makeUser({ role: 'ADMIN' }));
    expect(captureSyncError(() => requireDueManagementToken(access, 'dev-1')).code).toBe('DUE_MANAGEMENT_TOKEN_INVALID');

    const withSub = jwt.sign({ purpose: 'due-management', clientDeviceId: 'dev-1', sub: 'u-1' }, ACCESS, { expiresIn: '1h' });
    expect(captureSyncError(() => requireDueManagementToken(withSub, 'dev-1')).code).toBe('DUE_MANAGEMENT_TOKEN_INVALID');

    const withRole = jwt.sign({ purpose: 'due-management', clientDeviceId: 'dev-1', role: 'ADMIN' }, ACCESS, { expiresIn: '1h' });
    expect(captureSyncError(() => requireDueManagementToken(withRole, 'dev-1')).code).toBe('DUE_MANAGEMENT_TOKEN_INVALID');
  });

  it('rejects tokens with wrong purpose, no expiry or non-string device id', () => {
    const wrongPurpose = jwt.sign({ purpose: 'inventory', clientDeviceId: 'dev-1' }, ACCESS, { expiresIn: '1h' });
    expect(captureSyncError(() => requireDueManagementToken(wrongPurpose, 'dev-1')).code).toBe('DUE_MANAGEMENT_TOKEN_INVALID');

    const noExp = jwt.sign({ purpose: 'due-management', clientDeviceId: 'dev-1' }, ACCESS);
    expect(captureSyncError(() => requireDueManagementToken(noExp, 'dev-1')).code).toBe('DUE_MANAGEMENT_TOKEN_INVALID');

    const numericDevice = jwt.sign({ purpose: 'due-management', clientDeviceId: 1 }, ACCESS, { expiresIn: '1h' });
    expect(captureSyncError(() => requireDueManagementToken(numericDevice, '1')).code).toBe('DUE_MANAGEMENT_TOKEN_INVALID');
  });

  it('rejects a token issued to a different device', () => {
    const token = signDueManagementToken('dev-1');
    const error = captureSyncError(() => requireDueManagementToken(token, 'dev-2'));
    expect(error.code).toBe('DUE_MANAGEMENT_TOKEN_DEVICE_MISMATCH');
    expect(captureSyncError(() => requireDueManagementToken(token, undefined)).code).toBe('DUE_MANAGEMENT_TOKEN_DEVICE_MISMATCH');
  });
});
