import { afterEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ warn: vi.fn(), notify: vi.fn(async () => {}) }));
vi.mock('./env/load-dotenv.js', () => ({}));
vi.mock('../lib/logger.js', () => ({ logger: { warn: mocks.warn } }));
vi.mock('../services/auth/jwt-secret-alert.js', () => ({ notifySharedJwtSecret: mocks.notify }));
const strong = 'r8Yx9j4Lk6M2q7Wv5Nz3Pa1Bd0Cs4Ft6';
afterEach(() => { vi.unstubAllEnvs(); vi.resetModules(); vi.clearAllMocks(); });
async function load(mode: string, refresh: string) {
  vi.stubEnv('NODE_ENV', mode);
  vi.stubEnv('DATABASE_URL', 'postgresql://application:long-dedicated-password@localhost/app');
  vi.stubEnv('JWT_ACCESS_SECRET', strong);
  vi.stubEnv('JWT_REFRESH_SECRET', refresh);
  return import('./env.js');
}
describe('shared production signing key warning', () => {
  it('continues startup, logs and notifies without exposing the key', async () => {
    const { env } = await load('production', strong);
    expect(env.NODE_ENV).toBe('production');
    await vi.waitFor(() => expect(mocks.notify).toHaveBeenCalledOnce());
    expect(mocks.warn).toHaveBeenCalledOnce();
    expect(JSON.stringify(mocks.warn.mock.calls)).not.toContain(strong);
    expect(mocks.notify).toHaveBeenCalledWith();
  });
  it.each([['production', strong + 'different'], ['test', strong]])('does not warn for %s with separate keys or non-production', async (mode, refresh) => {
    await load(mode, refresh);
    expect(mocks.warn).not.toHaveBeenCalled();
    expect(mocks.notify).not.toHaveBeenCalled();
  });
  it('still rejects weak signing keys in production', async () => {
    await expect(load('production', 'weak')).rejects.toThrow();
    expect(mocks.notify).not.toHaveBeenCalled();
  });
});
