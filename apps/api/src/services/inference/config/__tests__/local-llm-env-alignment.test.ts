import { describe, expect, it } from 'vitest';

import type { InferenceProviderDefinition } from '../inference-provider.types.js';
import { collectLocalLlmProviderAlignmentIssues } from '../local-llm-env-alignment.js';

const baseProvider = (overrides: Partial<InferenceProviderDefinition> = {}): InferenceProviderDefinition => ({
  id: 'dgx_primary',
  baseUrl: 'http://100.118.82.72:38081',
  sharedToken: 'shared-secret',
  timeoutMs: 60_000,
  defaultModel: 'system-prod-primary',
  runtimeControl: {
    mode: 'on_demand',
    startUrl: 'http://100.118.82.72:38081/start',
    stopUrl: 'http://100.118.82.72:38081/stop',
    controlToken: '',
    healthBaseUrl: 'http://100.118.82.72:38081',
  },
  ...overrides,
});

describe('collectLocalLlmProviderAlignmentIssues', () => {
  it('flags unknown route provider id', () => {
    const providers = [baseProvider()];
    const issues = collectLocalLlmProviderAlignmentIssues(providers, {
      LOCAL_LLM_BASE_URL: 'http://100.118.82.72:38081',
      LOCAL_LLM_SHARED_TOKEN: 'shared-secret',
      LOCAL_LLM_MODEL: 'system-prod-primary',
      LOCAL_LLM_RUNTIME_MODE: 'on_demand',
      LOCAL_LLM_RUNTIME_CONTROL_START_URL: 'http://100.118.82.72:38081/start',
      LOCAL_LLM_RUNTIME_CONTROL_STOP_URL: 'http://100.118.82.72:38081/stop',
      LOCAL_LLM_RUNTIME_CONTROL_TOKEN: '',
      INFERENCE_PHOTO_LABEL_PROVIDER_ID: 'missing',
      INFERENCE_DOCUMENT_SUMMARY_PROVIDER_ID: 'dgx_primary',
    });
    expect(issues.some((i) => i.message.includes('unknown provider id'))).toBe(true);
  });

  it('requires LOCAL_LLM_SHARED_TOKEN to match primary sharedToken', () => {
    const providers = [baseProvider()];
    const issues = collectLocalLlmProviderAlignmentIssues(providers, {
      LOCAL_LLM_BASE_URL: 'http://100.118.82.72:38081',
      LOCAL_LLM_SHARED_TOKEN: 'wrong',
      LOCAL_LLM_MODEL: 'system-prod-primary',
      LOCAL_LLM_RUNTIME_MODE: 'on_demand',
      LOCAL_LLM_RUNTIME_CONTROL_START_URL: 'http://100.118.82.72:38081/start',
      LOCAL_LLM_RUNTIME_CONTROL_STOP_URL: 'http://100.118.82.72:38081/stop',
      INFERENCE_PHOTO_LABEL_PROVIDER_ID: 'dgx_primary',
      INFERENCE_DOCUMENT_SUMMARY_PROVIDER_ID: 'dgx_primary',
    });
    expect(issues.some((i) => i.message.includes('LOCAL_LLM_SHARED_TOKEN'))).toBe(true);
  });

  it('accepts on_demand when runtime control token empty on both sides (fallback to shared)', () => {
    const providers = [
      baseProvider({
        runtimeControl: {
          mode: 'on_demand',
          startUrl: 'http://100.118.82.72:38081/start',
          stopUrl: 'http://100.118.82.72:38081/stop',
          healthBaseUrl: 'http://100.118.82.72:38081',
        },
      }),
    ];
    const issues = collectLocalLlmProviderAlignmentIssues(providers, {
      LOCAL_LLM_BASE_URL: 'http://100.118.82.72:38081',
      LOCAL_LLM_SHARED_TOKEN: 'shared-secret',
      LOCAL_LLM_MODEL: 'system-prod-primary',
      LOCAL_LLM_RUNTIME_MODE: 'on_demand',
      LOCAL_LLM_RUNTIME_CONTROL_START_URL: 'http://100.118.82.72:38081/start',
      LOCAL_LLM_RUNTIME_CONTROL_STOP_URL: 'http://100.118.82.72:38081/stop',
      LOCAL_LLM_RUNTIME_CONTROL_TOKEN: undefined,
      INFERENCE_PHOTO_LABEL_PROVIDER_ID: 'dgx_primary',
      INFERENCE_DOCUMENT_SUMMARY_PROVIDER_ID: 'dgx_primary',
    });
    expect(issues.filter((i) => i.message.includes('runtime control token'))).toHaveLength(0);
  });

  it('requires start and stop urls for on_demand', () => {
    const providers = [
      baseProvider({
        runtimeControl: {
          mode: 'on_demand',
          healthBaseUrl: 'http://100.118.82.72:38081',
        },
      }),
    ];
    const issues = collectLocalLlmProviderAlignmentIssues(providers, {
      LOCAL_LLM_BASE_URL: 'http://100.118.82.72:38081',
      LOCAL_LLM_SHARED_TOKEN: 'shared-secret',
      LOCAL_LLM_MODEL: 'system-prod-primary',
      LOCAL_LLM_RUNTIME_MODE: 'on_demand',
      LOCAL_LLM_RUNTIME_CONTROL_START_URL: undefined,
      LOCAL_LLM_RUNTIME_CONTROL_STOP_URL: undefined,
      LOCAL_LLM_RUNTIME_CONTROL_TOKEN: undefined,
      INFERENCE_PHOTO_LABEL_PROVIDER_ID: 'dgx_primary',
      INFERENCE_DOCUMENT_SUMMARY_PROVIDER_ID: 'dgx_primary',
    });
    expect(issues.some((i) => i.message.includes('START_URL'))).toBe(true);
    expect(issues.some((i) => i.message.includes('STOP_URL'))).toBe(true);
  });

  it('uses id=default as primary when present', () => {
    const providers: InferenceProviderDefinition[] = [
      baseProvider({
        id: 'other',
        baseUrl: 'http://other/',
        sharedToken: 'x',
        defaultModel: 'm',
        runtimeControl: { mode: 'always_on' },
      }),
      baseProvider({ id: 'default', sharedToken: 'primary-secret' }),
    ];
    const issues = collectLocalLlmProviderAlignmentIssues(providers, {
      LOCAL_LLM_BASE_URL: 'http://100.118.82.72:38081',
      LOCAL_LLM_SHARED_TOKEN: 'primary-secret',
      LOCAL_LLM_MODEL: 'system-prod-primary',
      LOCAL_LLM_RUNTIME_MODE: 'on_demand',
      LOCAL_LLM_RUNTIME_CONTROL_START_URL: 'http://100.118.82.72:38081/start',
      LOCAL_LLM_RUNTIME_CONTROL_STOP_URL: 'http://100.118.82.72:38081/stop',
      INFERENCE_PHOTO_LABEL_PROVIDER_ID: 'default',
      INFERENCE_DOCUMENT_SUMMARY_PROVIDER_ID: 'default',
    });
    expect(issues).toHaveLength(0);
  });
});
