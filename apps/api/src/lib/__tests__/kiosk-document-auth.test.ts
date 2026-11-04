import type { FastifyReply, FastifyRequest } from 'fastify';
import jwt from 'jsonwebtoken';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  findUnique: vi.fn(),
  env: { ADMIN_MFA_REQUIRED: false, JWT_ACCESS_SECRET: 'doc-auth-secret' }
}));

vi.mock('../../config/env.js', () => ({ env: mocks.env }));
vi.mock('../prisma.js', () => ({ prisma: { clientDevice: { findUnique: mocks.findUnique } } }));

import { ApiError } from '../errors.js';
import { authorizeKioskClientKeyOrJwtRoles } from '../kiosk-document-auth.js';

type FakeRequest = FastifyRequest & { user?: { role: string } };

function makeRequest(headers: Record<string, unknown>): FakeRequest {
  return { headers, method: 'GET', routeOptions: { url: '/api/kiosk-documents' } } as unknown as FakeRequest;
}

const reply = { code: vi.fn().mockReturnThis() } as unknown as FastifyReply;

const bearer = (role: string) => `Bearer ${jwt.sign({ sub: 'u-1', username: 'alice', role }, 'doc-auth-secret')}`;

async function captureError(promise: Promise<unknown>): Promise<ApiError> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof ApiError) return error;
    throw error;
  }
  throw new Error('expected ApiError');
}

beforeEach(() => {
  mocks.findUnique.mockReset();
  mocks.findUnique.mockImplementation(async ({ where }: { where: { apiKey: string } }) =>
    where.apiKey === 'valid-key' ? { id: 'device-1', apiKey: 'valid-key' } : null
  );
});

describe('authorizeKioskClientKeyOrJwtRoles', () => {
  it('allows a registered client key without any JWT', async () => {
    const request = makeRequest({ 'x-client-key': 'valid-key' });
    await expect(authorizeKioskClientKeyOrJwtRoles(request, reply, ['ADMIN'])).resolves.toBeUndefined();
    expect(mocks.findUnique).toHaveBeenCalledWith({ where: { apiKey: 'valid-key' } });
    // Client-key access does not create a user identity.
    expect(request.user).toBeUndefined();
  });

  it('uses the first value of a repeated client key header', async () => {
    await authorizeKioskClientKeyOrJwtRoles(makeRequest({ 'x-client-key': ['valid-key', 'other'] }), reply, ['ADMIN']);
    expect(mocks.findUnique).toHaveBeenCalledWith({ where: { apiKey: 'valid-key' } });
  });

  it('rejects an unregistered client key with INVALID_CLIENT_KEY', async () => {
    const error = await captureError(authorizeKioskClientKeyOrJwtRoles(makeRequest({ 'x-client-key': 'bogus' }), reply, ['ADMIN']));
    expect(error.statusCode).toBe(401);
    expect(error.code).toBe('INVALID_CLIENT_KEY');
  });

  it('does not fall back to a valid JWT when an invalid client key is also sent', async () => {
    const request = makeRequest({ 'x-client-key': 'bogus', authorization: bearer('ADMIN') });
    const error = await captureError(authorizeKioskClientKeyOrJwtRoles(request, reply, ['ADMIN']));
    expect(error.code).toBe('INVALID_CLIENT_KEY');
  });

  it('does not unwrap a JSON-quoted client key, unlike normalizeClientKey', async () => {
    // NOTE: possible bug: other kiosk routes accept '"valid-key"' via normalizeClientKey,
    // but this guard looks up the raw header and rejects it.
    const error = await captureError(
      authorizeKioskClientKeyOrJwtRoles(makeRequest({ 'x-client-key': '"valid-key"' }), reply, ['ADMIN'])
    );
    expect(error.code).toBe('INVALID_CLIENT_KEY');
    expect(mocks.findUnique).toHaveBeenCalledWith({ where: { apiKey: '"valid-key"' } });
  });

  it('falls back to JWT role check when no client key is sent', async () => {
    const request = makeRequest({ authorization: bearer('MANAGER') });
    await authorizeKioskClientKeyOrJwtRoles(request, reply, ['ADMIN', 'MANAGER']);
    expect(request.user?.role).toBe('MANAGER');
    expect(mocks.findUnique).not.toHaveBeenCalled();
  });

  it('treats an empty client key header as absent and requires a JWT', async () => {
    const error = await captureError(authorizeKioskClientKeyOrJwtRoles(makeRequest({ 'x-client-key': '' }), reply, ['ADMIN']));
    expect(error.statusCode).toBe(401);
    expect(error.code).toBe('AUTH_TOKEN_REQUIRED');
    expect(mocks.findUnique).not.toHaveBeenCalled();
  });

  it('denies a JWT whose role is not in the allowed list', async () => {
    const error = await captureError(
      authorizeKioskClientKeyOrJwtRoles(makeRequest({ authorization: bearer('VIEWER') }), reply, ['ADMIN', 'MANAGER'])
    );
    expect(error.statusCode).toBe(403);
    expect(error.code).toBe('AUTH_INSUFFICIENT_PERMISSIONS');
  });

  it('rejects requests with neither client key nor JWT', async () => {
    const error = await captureError(authorizeKioskClientKeyOrJwtRoles(makeRequest({}), reply, ['VIEWER']));
    expect(error.statusCode).toBe(401);
    expect(error.code).toBe('AUTH_TOKEN_REQUIRED');
  });
});
