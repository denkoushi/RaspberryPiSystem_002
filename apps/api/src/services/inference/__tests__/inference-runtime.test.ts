import { afterEach, describe, expect, it } from 'vitest';

import { env } from '../../../config/env.js';
import { buildInferenceRuntime, resetInferenceRuntimeForTests } from '../inference-runtime.js';

const originalEnv = {
  inferenceProvidersJson: env.INFERENCE_PROVIDERS_JSON,
  adminProviderId: env.INFERENCE_ADMIN_PROVIDER_ID,
  adminModel: env.INFERENCE_ADMIN_MODEL,
  photoProviderId: env.INFERENCE_PHOTO_LABEL_PROVIDER_ID,
  photoModel: env.INFERENCE_PHOTO_LABEL_MODEL,
  documentProviderId: env.INFERENCE_DOCUMENT_SUMMARY_PROVIDER_ID,
  documentModel: env.INFERENCE_DOCUMENT_SUMMARY_MODEL,
  localBaseUrl: env.LOCAL_LLM_BASE_URL,
  localSharedToken: env.LOCAL_LLM_SHARED_TOKEN,
  localModel: env.LOCAL_LLM_MODEL,
  localTimeoutMs: env.LOCAL_LLM_TIMEOUT_MS,
  localRuntimeMode: env.LOCAL_LLM_RUNTIME_MODE,
  localStartUrl: env.LOCAL_LLM_RUNTIME_CONTROL_START_URL,
  localStopUrl: env.LOCAL_LLM_RUNTIME_CONTROL_STOP_URL,
  localControlToken: env.LOCAL_LLM_RUNTIME_CONTROL_TOKEN,
  localHealthBaseUrl: env.LOCAL_LLM_RUNTIME_HEALTH_BASE_URL,
};

afterEach(() => {
  env.INFERENCE_PROVIDERS_JSON = originalEnv.inferenceProvidersJson;
  env.INFERENCE_ADMIN_PROVIDER_ID = originalEnv.adminProviderId;
  env.INFERENCE_ADMIN_MODEL = originalEnv.adminModel;
  env.INFERENCE_PHOTO_LABEL_PROVIDER_ID = originalEnv.photoProviderId;
  env.INFERENCE_PHOTO_LABEL_MODEL = originalEnv.photoModel;
  env.INFERENCE_DOCUMENT_SUMMARY_PROVIDER_ID = originalEnv.documentProviderId;
  env.INFERENCE_DOCUMENT_SUMMARY_MODEL = originalEnv.documentModel;
  env.LOCAL_LLM_BASE_URL = originalEnv.localBaseUrl;
  env.LOCAL_LLM_SHARED_TOKEN = originalEnv.localSharedToken;
  env.LOCAL_LLM_MODEL = originalEnv.localModel;
  env.LOCAL_LLM_TIMEOUT_MS = originalEnv.localTimeoutMs;
  env.LOCAL_LLM_RUNTIME_MODE = originalEnv.localRuntimeMode;
  env.LOCAL_LLM_RUNTIME_CONTROL_START_URL = originalEnv.localStartUrl;
  env.LOCAL_LLM_RUNTIME_CONTROL_STOP_URL = originalEnv.localStopUrl;
  env.LOCAL_LLM_RUNTIME_CONTROL_TOKEN = originalEnv.localControlToken;
  env.LOCAL_LLM_RUNTIME_HEALTH_BASE_URL = originalEnv.localHealthBaseUrl;
  resetInferenceRuntimeForTests();
});

describe('buildInferenceRuntime', () => {
  it('uses explicit admin provider and model override', () => {
    env.INFERENCE_PROVIDERS_JSON = JSON.stringify([
      {
        id: 'legacy_green',
        baseUrl: 'http://green:38081',
        sharedToken: 'green-token',
        defaultModel: 'green-model',
        timeoutMs: 60000,
      },
      {
        id: 'trtllm_blue',
        baseUrl: 'http://blue:38081',
        sharedToken: 'blue-token',
        defaultModel: 'blue-model',
        timeoutMs: 45000,
      },
    ]);
    env.INFERENCE_ADMIN_PROVIDER_ID = 'trtllm_blue';
    env.INFERENCE_ADMIN_MODEL = 'system-prod-primary';
    env.INFERENCE_PHOTO_LABEL_PROVIDER_ID = 'legacy_green';
    env.INFERENCE_DOCUMENT_SUMMARY_PROVIDER_ID = 'legacy_green';

    const runtime = buildInferenceRuntime();

    expect(runtime.getAdminProvider()?.id).toBe('trtllm_blue');
    expect(runtime.getAdminLocalLlmRuntimeConfig()).toMatchObject({
      configured: true,
      baseUrl: 'http://blue:38081',
      sharedToken: 'blue-token',
      model: 'system-prod-primary',
      timeoutMs: 45000,
    });
  });

  it('falls back to synthesized legacy provider when INFERENCE_PROVIDERS_JSON is absent', () => {
    env.INFERENCE_PROVIDERS_JSON = undefined;
    env.LOCAL_LLM_BASE_URL = 'http://legacy:38081';
    env.LOCAL_LLM_SHARED_TOKEN = 'legacy-token';
    env.LOCAL_LLM_MODEL = 'system-prod-primary';
    env.LOCAL_LLM_TIMEOUT_MS = 61000;
    env.LOCAL_LLM_RUNTIME_MODE = 'always_on';
    env.INFERENCE_ADMIN_PROVIDER_ID = 'default';
    env.INFERENCE_ADMIN_MODEL = undefined;
    env.INFERENCE_PHOTO_LABEL_PROVIDER_ID = 'default';
    env.INFERENCE_DOCUMENT_SUMMARY_PROVIDER_ID = 'default';

    const runtime = buildInferenceRuntime();

    expect(runtime.getAdminProvider()?.id).toBe('default');
    expect(runtime.getAdminLocalLlmRuntimeConfig()).toMatchObject({
      configured: true,
      baseUrl: 'http://legacy:38081',
      sharedToken: 'legacy-token',
      model: 'system-prod-primary',
      timeoutMs: 61000,
    });
  });
});
