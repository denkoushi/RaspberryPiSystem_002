import { describe, expect, it } from 'vitest';

import type { InferenceProviderDefinition } from '../inference-provider.types.js';
import {
  resolveAdminInferenceModel,
  resolveAdminInferenceProvider,
} from '../admin-inference-provider.js';

const providers: InferenceProviderDefinition[] = [
  {
    id: 'legacy_green',
    baseUrl: 'http://localhost:38081',
    sharedToken: 'green-token',
    timeoutMs: 60_000,
    defaultModel: 'green-model',
  },
  {
    id: 'default',
    baseUrl: 'http://localhost:38082',
    sharedToken: 'default-token',
    timeoutMs: 60_000,
    defaultModel: 'default-model',
  },
  {
    id: 'trtllm_blue',
    baseUrl: 'http://localhost:38083',
    sharedToken: 'blue-token',
    timeoutMs: 60_000,
    defaultModel: 'blue-model',
  },
];

describe('admin-inference-provider', () => {
  it('prefers id=default when admin provider id is omitted', () => {
    expect(resolveAdminInferenceProvider(providers, undefined)?.id).toBe('default');
  });

  it('falls back to first provider when admin provider id is default but no default provider exists', () => {
    expect(resolveAdminInferenceProvider([providers[0], providers[2]], 'default')?.id).toBe('legacy_green');
  });

  it('resolves explicitly requested admin provider id', () => {
    expect(resolveAdminInferenceProvider(providers, 'trtllm_blue')?.id).toBe('trtllm_blue');
  });

  it('uses explicit admin model override before provider defaultModel', () => {
    expect(resolveAdminInferenceModel(providers[2], 'system-prod-primary')).toBe('system-prod-primary');
    expect(resolveAdminInferenceModel(providers[2], undefined)).toBe('blue-model');
  });
});
