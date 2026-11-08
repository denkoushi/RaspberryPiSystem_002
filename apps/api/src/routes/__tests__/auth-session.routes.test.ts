import Fastify from 'fastify';
import bcrypt from 'bcryptjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ findActor: vi.fn(), revoke: vi.fn(), updateRole: vi.fn(), authenticated: true }));
vi.mock('../../lib/auth.js', () => {
  const authenticate = async (request: { user: unknown }) => {
    if (!mocks.authenticated) { const error = new Error('unauthorized') as Error & { statusCode: number }; error.statusCode = 401; throw error; }
    request.user = { id: 'admin', username: 'admin', role: 'ADMIN', sessionId: 's1' };
  };
  return { authenticate, authorizeRoles: () => authenticate };
});
vi.mock('../../lib/prisma.js', () => ({ prisma: { user: { findUniqueOrThrow: mocks.findActor }, authSession: { updateMany: mocks.revoke } } }));
vi.mock('../../services/auth/auth.service.js', () => ({ AuthService: class {} }));
vi.mock('../../services/auth/auth-role-admin.service.js', () => ({ AuthRoleAdminService: class { updateUserRole = mocks.updateRole; } }));
import { registerAuthRoutes } from '../auth.js';
beforeEach(() => { vi.clearAllMocks(); mocks.authenticated = true; mocks.findActor.mockResolvedValue({ passwordHash: bcrypt.hashSync('correct', 4) }); mocks.updateRole.mockResolvedValue({ user: { role: 'MANAGER' } }); });
async function inject(url: string, payload: unknown) {
  const app = Fastify();
  app.setErrorHandler((error, _req, reply) => { const err = error as { statusCode?: number; name?: string }; return reply.code(err.name === 'ZodError' ? 400 : err.statusCode ?? 500).send({}); });
  await registerAuthRoutes(app);
  try { return await app.inject({ method: 'POST', url, payload }); } finally { await app.close(); }
}
const target = 'b129a886-b93a-41ba-a132-74ec5f318b9e';
describe('auth session routes', () => {
  it.each([undefined, 'wrong'])('rejects missing or wrong acting-user password (%s)', async (currentPassword) => {
    const response = await inject(`/auth/users/${target}/role`, { role: 'MANAGER', currentPassword });
    expect(response.statusCode).toBe(currentPassword ? 401 : 400);
    expect(mocks.updateRole).not.toHaveBeenCalled();
  });
  it('changes a role after password re-entry', async () => {
    expect((await inject(`/auth/users/${target}/role`, { role: 'MANAGER', currentPassword: 'correct' })).statusCode).toBe(200);
    expect(mocks.updateRole).toHaveBeenCalledWith(expect.objectContaining({ actorSessionId: 's1', targetUserId: target, nextRole: 'MANAGER' }));
  });
  it('requires authentication for logout and revokes only the current session', async () => {
    mocks.authenticated = false;
    expect((await inject('/auth/logout', {})).statusCode).toBe(401);
    expect(mocks.revoke).not.toHaveBeenCalled();
    mocks.authenticated = true;
    expect((await inject('/auth/logout', {})).statusCode).toBe(200);
    expect(mocks.revoke).toHaveBeenCalledWith({ where: { id: 's1', userId: 'admin' }, data: { revokedAt: expect.any(Date) } });
  });
});
