import { describe, expect, it, beforeEach } from 'vitest';

import {
  assertBusinessProfileIntentEnvConsistency,
  resolveBusinessRuntimeStartProfile,
  resolveRuntimeStartProfileIdForBusinessUseCase,
} from '../business-profile-intent.js';
import {
  getBusinessProfileIntentStore,
  resetBusinessProfileIntentStoreForTests,
} from '../business-profile-intent-store.js';

const provider = {
  id: 'dgx_primary',
  baseUrl: 'http://dgx:38081',
  sharedToken: 't',
  timeoutMs: 60_000,
  defaultModel: 'system-prod-primary',
  runtimeStartProfileId: 'business_qwen36_27b_nvfp4',
};

describe('business-profile-intent', () => {
  beforeEach(() => {
    resetBusinessProfileIntentStoreForTests();
  });

  it('prefers provider runtimeStartProfileId', () => {
    expect(resolveBusinessRuntimeStartProfile({}, provider)?.modelProfileId).toBe(
      'business_qwen36_27b_nvfp4'
    );
  });

  it('uses orchestration store when provider has no profile', () => {
    const { runtimeStartProfileId: _removed, ...noProfile } = provider;
    getBusinessProfileIntentStore().setFromOrchestration('business_qwen35_35b_gguf');
    expect(resolveBusinessRuntimeStartProfile({}, noProfile)?.modelProfileId).toBe(
      'business_qwen35_35b_gguf'
    );
    expect(resolveBusinessRuntimeStartProfile({}, noProfile)?.source).toBe('orchestration');
  });

  it('uses INFERENCE_BUSINESS_RUNTIME_START_PROFILE_ID when store empty', () => {
    const { runtimeStartProfileId: _removed, ...noProfile } = provider;
    expect(
      resolveBusinessRuntimeStartProfile(
        { businessRuntimeStartProfileId: 'business_qwen36_27b_nvfp4' },
        noProfile
      )?.modelProfileId
    ).toBe('business_qwen36_27b_nvfp4');
  });

  it('propagates same profile to all business use cases', () => {
    const { runtimeStartProfileId: _removed, ...noProfile } = provider;
    const env = { businessRuntimeStartProfileId: 'business_qwen35_35b_gguf' };
    for (const useCase of ['photo_label', 'document_summary', 'admin_console_chat', 'stackchan_chat'] as const) {
      expect(resolveRuntimeStartProfileIdForBusinessUseCase(useCase, env, noProfile)).toBe(
        'business_qwen35_35b_gguf'
      );
    }
  });

  it('assertBusinessProfileIntentEnvConsistency rejects conflicting legacy env', () => {
    expect(() =>
      assertBusinessProfileIntentEnvConsistency({
        businessRuntimeStartProfileId: 'business_qwen36_27b_nvfp4',
        photoLabelRuntimeStartProfileId: 'business_qwen35_35b_gguf',
      })
    ).toThrow(/conflicts with per-use-case/);
  });

  it('prefers INFERENCE_BUSINESS env over orchestration store', () => {
    getBusinessProfileIntentStore().setFromOrchestration('business_qwen35_35b_gguf');
    const { runtimeStartProfileId: _removed, ...noProfile } = provider;
    expect(
      resolveBusinessRuntimeStartProfile(
        { businessRuntimeStartProfileId: 'business_qwen36_27b_nvfp4' },
        noProfile
      )?.modelProfileId
    ).toBe('business_qwen36_27b_nvfp4');
    expect(
      resolveBusinessRuntimeStartProfile(
        { businessRuntimeStartProfileId: 'business_qwen36_27b_nvfp4' },
        noProfile
      )?.source
    ).toBe('env');
  });
});
