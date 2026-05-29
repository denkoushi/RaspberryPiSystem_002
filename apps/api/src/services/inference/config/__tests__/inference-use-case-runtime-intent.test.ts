import { describe, expect, it } from 'vitest';

import { InferenceRouter } from '../../routing/inference-router.js';
import {
  assertConsistentRuntimeProfileIntentOnSharedProviders,
  buildOnDemandControllerCacheKey,
  resolveRuntimeStartProfileIdForUseCase,
  RUNTIME_INTENT_USE_CASES,
  shouldSendRuntimeStartProfileId,
} from '../inference-use-case-runtime-intent.js';

const provider = {
  id: 'dgx_primary',
  baseUrl: 'http://dgx:38081',
  sharedToken: 't',
  timeoutMs: 60_000,
  defaultModel: 'system-prod-primary',
  runtimeStartProfileId: 'business_qwen36_27b_nvfp4',
};

describe('inference-use-case-runtime-intent', () => {
  it('prefers provider runtimeStartProfileId', () => {
    expect(
      resolveRuntimeStartProfileIdForUseCase(
        'photo_label',
        { runtimeStartProfileEnabled: false, photoLabelRuntimeStartProfileId: 'business_qwen35_35b_gguf' },
        provider
      )
    ).toBe('business_qwen36_27b_nvfp4');
  });

  it('uses use-case env when provider has no profile', () => {
    const { runtimeStartProfileId: _removed, ...noProfile } = provider;
    expect(
      resolveRuntimeStartProfileIdForUseCase(
        'document_summary',
        {
          runtimeStartProfileEnabled: true,
          documentSummaryRuntimeStartProfileId: 'business_qwen36_27b_nvfp4',
        },
        noProfile
      )
    ).toBe('business_qwen36_27b_nvfp4');
  });

  it('buildOnDemandControllerCacheKey uses shared business profile for all use cases', () => {
    const env = {
      runtimeStartProfileEnabled: true,
      businessRuntimeStartProfileId: 'business_qwen35_35b_gguf',
      photoLabelRuntimeStartProfileId: 'business_qwen36_27b_nvfp4',
      documentSummaryRuntimeStartProfileId: 'business_qwen36_27b_nvfp4',
    };
    const { runtimeStartProfileId: _removed, ...noProviderProfile } = provider;
    expect(buildOnDemandControllerCacheKey(noProviderProfile, 'photo_label', env)).toBe(
      'dgx_primary::business_qwen35_35b_gguf'
    );
    expect(buildOnDemandControllerCacheKey(noProviderProfile, 'admin_console_chat', env)).toBe(
      'dgx_primary::business_qwen35_35b_gguf'
    );
  });

  it('buildOnDemandControllerCacheKey separates profiles when opt-in enabled', () => {
    const env = {
      runtimeStartProfileEnabled: true,
      photoLabelRuntimeStartProfileId: 'business_qwen35_35b_gguf',
      documentSummaryRuntimeStartProfileId: 'business_qwen36_27b_nvfp4',
    };
    const { runtimeStartProfileId: _removed, ...noProviderProfile } = provider;
    expect(buildOnDemandControllerCacheKey(noProviderProfile, 'photo_label', env)).toBe(
      'dgx_primary::business_qwen35_35b_gguf'
    );
    expect(buildOnDemandControllerCacheKey(noProviderProfile, 'document_summary', env)).toBe(
      'dgx_primary::business_qwen36_27b_nvfp4'
    );
  });

  it('assertConsistentRuntimeProfileIntentOnSharedProviders rejects conflicting profiles', () => {
    const providers = [
      {
        id: 'dgx_primary',
        baseUrl: 'http://dgx:38081',
        sharedToken: 't',
        timeoutMs: 60_000,
        defaultModel: 'system-prod-primary',
        runtimeControl: { mode: 'on_demand' as const, startUrl: 'http://x/start', stopUrl: 'http://x/stop' },
      },
    ];
    const router = new InferenceRouter({
      providers,
      routes: {
        photo_label: { providerId: 'dgx_primary' },
        document_summary: { providerId: 'dgx_primary' },
      },
    });
    expect(() =>
      assertConsistentRuntimeProfileIntentOnSharedProviders(router, () => providers[0], {
        runtimeStartProfileEnabled: true,
        photoLabelRuntimeStartProfileId: 'business_qwen35_35b_gguf',
        documentSummaryRuntimeStartProfileId: 'business_qwen36_27b_nvfp4',
      })
    ).toThrow(/conflicting runtimeStartProfileId/);
  });

  it('assertConsistentRuntimeProfileIntentOnSharedProviders can use legacy admin runtime control', () => {
    const providers = [
      {
        id: 'dgx_primary',
        baseUrl: 'http://dgx:38081',
        sharedToken: 't',
        timeoutMs: 60_000,
        defaultModel: 'system-prod-primary',
      },
      {
        id: 'ubuntu_vlm',
        baseUrl: 'http://ubuntu:38081',
        sharedToken: 'u',
        timeoutMs: 60_000,
        defaultModel: 'vlm',
        runtimeControl: { mode: 'on_demand' as const, startUrl: 'http://u/start', stopUrl: 'http://u/stop' },
      },
    ];
    const router = new InferenceRouter({
      providers,
      routes: {
        photo_label: { providerId: 'ubuntu_vlm' },
        document_summary: { providerId: 'ubuntu_vlm' },
      },
    });
    expect(() =>
      assertConsistentRuntimeProfileIntentOnSharedProviders(
        router,
        () => providers[0],
        {
          runtimeStartProfileEnabled: true,
          photoLabelRuntimeStartProfileId: 'business_qwen35_35b_gguf',
          documentSummaryRuntimeStartProfileId: 'business_qwen35_35b_gguf',
          adminRuntimeStartProfileId: 'business_qwen36_27b_nvfp4',
        },
        (provider) =>
          provider.id === 'dgx_primary'
            ? { mode: 'on_demand' as const }
            : provider.runtimeControl
      )
    ).not.toThrow();
  });

  it('shouldSendRuntimeStartProfileId requires enabled flag', () => {
    expect(shouldSendRuntimeStartProfileId({ runtimeStartProfileEnabled: false }, 'business_qwen36_27b_nvfp4')).toBe(
      false
    );
    expect(shouldSendRuntimeStartProfileId({ runtimeStartProfileEnabled: true }, 'business_qwen36_27b_nvfp4')).toBe(
      true
    );
  });

  it('resolves the same business profile for all four runtime intent use cases', () => {
    const env = {
      runtimeStartProfileEnabled: true,
      businessRuntimeStartProfileId: 'business_qwen35_35b_gguf',
    };
    const { runtimeStartProfileId: _removed, ...noProviderProfile } = provider;
    for (const useCase of RUNTIME_INTENT_USE_CASES) {
      expect(resolveRuntimeStartProfileIdForUseCase(useCase, env, noProviderProfile)).toBe(
        'business_qwen35_35b_gguf'
      );
    }
  });
});
