import { afterEach, describe, expect, it, vi } from 'vitest';

const ORIGINAL_ENV = { ...process.env };

const loadEnvModule = async () => {
  vi.resetModules();
  return import('../env.js');
};

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
  vi.resetModules();
});

describe('env secret policy', () => {
  it('allows defaults outside production', async () => {
    process.env.NODE_ENV = 'development';
    delete process.env.JWT_ACCESS_SECRET;
    delete process.env.JWT_REFRESH_SECRET;

    await expect(loadEnvModule()).resolves.toBeDefined();
  });

  it('fails fast in production when weak secrets are used', async () => {
    process.env.NODE_ENV = 'production';
    process.env.JWT_ACCESS_SECRET = 'dev-access-secret-change-me';
    process.env.JWT_REFRESH_SECRET = 'dev-refresh-secret-change-me';

    await expect(loadEnvModule()).rejects.toThrow(/JWT_ACCESS_SECRET|JWT_REFRESH_SECRET/);
  });

  it('starts in production with strong secrets', async () => {
    process.env.NODE_ENV = 'production';
    process.env.JWT_ACCESS_SECRET = 'prod-access-secret-0123456789-abcdefghijklmnopqrstuvwxyz';
    process.env.JWT_REFRESH_SECRET = 'prod-refresh-secret-0123456789-abcdefghijklmnopqrstuvwxyz';

    await expect(loadEnvModule()).resolves.toBeDefined();
  });
});
