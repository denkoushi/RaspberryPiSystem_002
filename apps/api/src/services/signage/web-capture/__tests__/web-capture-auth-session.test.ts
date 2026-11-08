import { beforeEach, describe, expect, it, vi } from 'vitest';
import jwt from 'jsonwebtoken';
const mocks = vi.hoisted(() => ({ create: vi.fn(), cleanup: vi.fn() }));
vi.mock('../../../../config/env.js', () => ({ env: { JWT_ACCESS_SECRET: 'capture-access', TOKEN_EXPIRES_IN: '15m' } }));
vi.mock('../../../../lib/prisma.js', () => ({ prisma: { authSession: { create: mocks.create } } }));
vi.mock('../../../auth/auth-session.service.js', () => ({ deleteExpiredAuthSessions: mocks.cleanup }));
import { signWebCaptureToken } from '../web-capture-auth-session.js';
beforeEach(() => { vi.clearAllMocks(); mocks.create.mockImplementation(async ({ data }) => ({ id: 'capture-session', ...data })); });
describe('web capture session token', () => {
  it('keeps the automatic page capture authenticated with a short server session', async () => {
    const before = Date.now();
    const token = await signWebCaptureToken({ id: 'viewer', username: 'viewer', role: 'VIEWER' });
    expect(jwt.verify(token, 'capture-access')).toMatchObject({ sub: 'viewer', sessionId: 'capture-session', tokenType: 'access' });
    const expiresAt = mocks.create.mock.calls[0][0].data.expiresAt as Date;
    expect(expiresAt.getTime() - before).toBeGreaterThanOrEqual(15 * 60 * 1000);
    expect(expiresAt.getTime() - before).toBeLessThan(15 * 60 * 1000 + 1000);
    expect(mocks.cleanup).toHaveBeenCalledOnce();
  });
  it('does not issue an unusable token if session creation fails', async () => {
    mocks.create.mockRejectedValue(new Error('database unavailable'));
    await expect(signWebCaptureToken({ id: 'viewer', username: 'viewer', role: 'VIEWER' })).rejects.toThrow('database unavailable');
  });
});
