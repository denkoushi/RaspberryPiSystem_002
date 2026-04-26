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

  it('fails when INFERENCE_PROVIDERS_JSON primary sharedToken mismatches LOCAL_LLM_SHARED_TOKEN', async () => {
    process.env.NODE_ENV = 'production';
    process.env.JWT_ACCESS_SECRET = 'prod-access-secret-0123456789-abcdefghijklmnopqrstuvwxyz';
    process.env.JWT_REFRESH_SECRET = 'prod-refresh-secret-0123456789-abcdefghijklmnopqrstuvwxyz';
    process.env.LOCAL_LLM_BASE_URL = 'http://100.118.82.72:38081';
    process.env.LOCAL_LLM_SHARED_TOKEN = 'token-a';
    process.env.LOCAL_LLM_MODEL = 'system-prod-primary';
    process.env.LOCAL_LLM_RUNTIME_MODE = 'on_demand';
    process.env.LOCAL_LLM_RUNTIME_CONTROL_START_URL = 'http://100.118.82.72:38081/start';
    process.env.LOCAL_LLM_RUNTIME_CONTROL_STOP_URL = 'http://100.118.82.72:38081/stop';
    process.env.INFERENCE_PHOTO_LABEL_PROVIDER_ID = 'dgx_primary';
    process.env.INFERENCE_DOCUMENT_SUMMARY_PROVIDER_ID = 'dgx_primary';
    process.env.INFERENCE_PROVIDERS_JSON = JSON.stringify([
      {
        id: 'dgx_primary',
        baseUrl: 'http://100.118.82.72:38081',
        sharedToken: 'token-b',
        defaultModel: 'system-prod-primary',
        timeoutMs: 60_000,
        runtimeControl: {
          mode: 'on_demand',
          startUrl: 'http://100.118.82.72:38081/start',
          stopUrl: 'http://100.118.82.72:38081/stop',
          healthBaseUrl: 'http://100.118.82.72:38081',
        },
      },
    ]);

    await expect(loadEnvModule()).rejects.toThrow(/LOCAL_LLM_SHARED_TOKEN|admin inference/);
  });
});
