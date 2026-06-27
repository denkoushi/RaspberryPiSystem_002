import { describe, expect, it, vi } from 'vitest';

import {
  assertModelProfileEligibleForBusinessReturn,
  assertModelProfileKnownAndStartable,
  fetchDgxModelProfilesOverview,
} from '../dgx-resource.model-profiles.js';

describe('fetchDgxModelProfilesOverview', () => {
  it('returns ok when profiles are fetched and activeProfileId is null', async () => {
    const fetchImpl = vi.fn(async (): Promise<Response> => ({
      ok: true,
      status: 200,
      headers: new Headers(),
      url: 'http://127.0.0.1:38081/system/model-profiles',
      text: async () => '',
      json: async () => ({
        ok: true,
        activeProfileId: null,
        profiles: [
          {
            id: 'business_qwen36_27b_nvfp4',
            displayNameJa: 'Qwen3.6 27B NVFP4',
            backend: 'blue',
            servedAlias: 'system-prod-primary',
            recommended: true,
            enabled: true,
            status: 'available',
            runtimeProfile: {
              engine: 'vllm',
              memoryPolicy: 'known_good_business_text_tools',
              vllm: {
                gpuMemoryUtilization: 0.65,
                maxModelLen: 8192,
                languageModelOnly: true,
                quantization: 'compressed-tensors',
                disableCustomAllReduce: true,
                tensorParallelSize: 2,
              },
            },
            deleteProtection: {
              canDelete: false,
              protected: true,
              reasons: ['active_profile'],
              reasonJa: '現在 active なモデルは削除できません',
              storagePath: '/srv/dgx/hf-cache/hub/models--qwen',
              resolvedStoragePath: '/srv/dgx/hf-cache/hub/models--qwen',
            },
          },
        ],
        resourceState: {
          owner: 'business',
          status: 'preparing',
          updatedAt: '2026-06-07T00:00:00Z',
          action: 'start',
          reason: 'scenario_guide_model_profile',
          modelProfileId: 'business_qwen36_27b_nvfp4',
          displayNameJa: 'Qwen3.6 27B NVFP4',
          backend: 'blue',
          guaranteeLevel: 'post_only',
        },
      }),
    })) as typeof fetch;

    const overview = await fetchDgxModelProfilesOverview({
      baseUrl: 'http://127.0.0.1:38081',
      sharedToken: 'x'.repeat(32),
      fetchImpl,
      timeoutMs: 3000,
    });

    expect(overview.status).toBe('ok');
    expect(overview.activeProfileId).toBeNull();
    expect(overview.activeStateBackend).toBeNull();
    expect(overview.lastLoadedProfileId).toBeNull();
    expect(overview.errorMessageJa).toBeUndefined();
    expect(overview.available).toHaveLength(1);
    expect(overview.businessReturnSelectable).toHaveLength(1);
    expect(overview.available[0]?.runtimeProfile?.vllm?.gpuMemoryUtilization).toBe(0.65);
    expect(overview.available[0]?.runtimeProfile?.vllm?.quantization).toBe('compressed-tensors');
    expect(overview.available[0]?.runtimeProfile?.vllm?.disableCustomAllReduce).toBe(true);
    expect(overview.available[0]?.runtimeProfile?.vllm?.tensorParallelSize).toBe(2);
    expect(overview.available[0]?.deleteProtection?.canDelete).toBe(false);
    expect(overview.available[0]?.deleteProtection?.reasons).toEqual(['active_profile']);
    expect(overview.resourceState?.owner).toBe('business');
    expect(overview.resourceState?.modelProfileId).toBe('business_qwen36_27b_nvfp4');
  });

  it('excludes businessOrchestrationEligible=false from businessReturnSelectable', async () => {
    const fetchImpl = vi.fn(async (): Promise<Response> => ({
      ok: true,
      status: 200,
      headers: new Headers(),
      url: 'http://127.0.0.1:38081/system/model-profiles',
      text: async () => '',
      json: async () => ({
        ok: true,
        activeProfileId: null,
        profiles: [
          {
            id: 'business_qwen36_27b_nvfp4',
            displayNameJa: 'Qwen3.6 27B NVFP4',
            backend: 'blue',
            servedAlias: 'system-prod-primary',
            recommended: true,
            businessOrchestrationEligible: true,
            enabled: true,
            status: 'available',
          },
          {
            id: 'qwen36_35b_uncensored',
            displayNameJa: 'qwen36_35b_uncensored',
            backend: 'green',
            servedAlias: 'system-prod-primary',
            recommended: false,
            businessOrchestrationEligible: false,
            enabled: true,
            status: 'available',
          },
          {
            id: 'business_ornith_35b_nvfp4',
            displayNameJa: 'Ornith 1.0 35B NVFP4',
            backend: 'blue',
            servedAlias: 'system-prod-primary',
            recommended: false,
            businessOrchestrationEligible: true,
            enabled: true,
            status: 'available',
          },
        ],
      }),
    })) as typeof fetch;

    const overview = await fetchDgxModelProfilesOverview({
      baseUrl: 'http://127.0.0.1:38081',
      sharedToken: 'x'.repeat(32),
      fetchImpl,
      timeoutMs: 3000,
    });

    expect(overview.available).toHaveLength(3);
    expect(overview.businessReturnSelectable.map((p) => p.id)).toEqual([
      'business_qwen36_27b_nvfp4',
      'business_ornith_35b_nvfp4',
    ]);
  });

  it('parses activeStateBackend from state payload', async () => {
    const fetchImpl = vi.fn(async (): Promise<Response> => ({
      ok: true,
      status: 200,
      headers: new Headers(),
      url: 'http://127.0.0.1:38081/system/model-profiles',
      text: async () => '',
      json: async () => ({
        ok: true,
        activeProfileId: 'business_qwen36_27b_nvfp4',
        state: { backend: 'blue', modelProfileId: 'business_qwen36_27b_nvfp4' },
        profiles: [
          {
            id: 'business_qwen36_27b_nvfp4',
            displayNameJa: 'Qwen3.6 27B NVFP4',
            backend: 'blue',
            servedAlias: 'system-prod-primary',
            recommended: true,
            enabled: true,
            status: 'available',
          },
        ],
      }),
    })) as typeof fetch;

    const overview = await fetchDgxModelProfilesOverview({
      baseUrl: 'http://127.0.0.1:38081',
      sharedToken: 'x'.repeat(32),
      fetchImpl,
      timeoutMs: 3000,
    });

    expect(overview.activeStateBackend).toBe('blue');
  });

  it('parses activeRuntimeState capabilities from state payload', async () => {
    const fetchImpl = vi.fn(async (): Promise<Response> => ({
      ok: true,
      status: 200,
      headers: new Headers(),
      url: 'http://127.0.0.1:38081/system/model-profiles',
      text: async () => '',
      json: async () => ({
        ok: true,
        activeProfileId: 'business_qwen35_35b_gguf',
        state: {
          backend: 'green',
          runtimeReadyCapabilities: ['text', 'vision'],
          visionReadyReason: 'vision',
        },
        profiles: [],
      }),
    })) as typeof fetch;

    const overview = await fetchDgxModelProfilesOverview({
      baseUrl: 'http://127.0.0.1:38081',
      sharedToken: 'x'.repeat(32),
      fetchImpl,
      timeoutMs: 3000,
    });

    expect(overview.activeRuntimeState?.runtimeReadyCapabilities).toEqual(['text', 'vision']);
    expect(overview.activeRuntimeState?.visionReadyReason).toBe('vision');
  });

  it('returns degraded when HTTP request fails', async () => {
    const fetchImpl = vi.fn(async (): Promise<Response> => ({
      ok: false,
      status: 503,
      headers: new Headers(),
      url: 'http://127.0.0.1:38081/system/model-profiles',
      text: async () => '',
      json: async () => ({}),
    })) as typeof fetch;

    const overview = await fetchDgxModelProfilesOverview({
      baseUrl: 'http://127.0.0.1:38081',
      sharedToken: 'x'.repeat(32),
      fetchImpl,
      timeoutMs: 3000,
    });

    expect(overview.status).toBe('degraded');
    expect(overview.available).toEqual([]);
    expect(overview.errorMessageJa).toContain('HTTP 503');
  });
});

describe('assertModelProfileKnownAndStartable', () => {
  it('allows startable profile when overview is ok and activeProfileId is null', () => {
    const profile = assertModelProfileKnownAndStartable(
      {
        configured: true,
        status: 'ok',
        activeProfileId: null,
        activeStateBackend: null,
        activeRuntimeState: null,
        pendingProfileId: null,
        lastLoadedProfileId: null,
        resourceState: null,
        available: [
          {
            id: 'business_qwen35_35b_gguf',
            displayNameJa: 'Qwen3.5 35B GGUF',
            backend: 'green',
            servedAlias: 'system-prod-primary',
            recommended: false,
            businessOrchestrationEligible: true,
            enabled: true,
            status: 'available',
            canonicalNames: [],
            legacyNames: [],
          },
        ],
        businessReturnSelectable: [],
      },
      'business_qwen35_35b_gguf'
    );

    expect(profile.id).toBe('business_qwen35_35b_gguf');
  });
});

describe('assertModelProfileEligibleForBusinessReturn', () => {
  const overviewBase = {
    configured: true,
    status: 'ok' as const,
    activeProfileId: null,
    activeStateBackend: null,
    activeRuntimeState: null,
    pendingProfileId: null,
    lastLoadedProfileId: null,
    resourceState: null,
    businessReturnSelectable: [],
    available: [
      {
        id: 'qwen36_35b_uncensored',
        displayNameJa: 'uncensored',
        backend: 'green' as const,
        servedAlias: 'system-prod-primary',
        recommended: false,
        businessOrchestrationEligible: false,
        enabled: true,
        status: 'available' as const,
        canonicalNames: [],
        legacyNames: [],
      },
    ],
  };

  it('rejects private-only profile for business return', () => {
    expect(() =>
      assertModelProfileEligibleForBusinessReturn(overviewBase, 'qwen36_35b_uncensored')
    ).toThrowError(
      expect.objectContaining({ code: 'DGX_MODEL_PROFILE_NOT_ELIGIBLE_FOR_BUSINESS_RETURN' })
    );
  });

  it('still allows START_MODEL_PROFILE path via assertModelProfileKnownAndStartable', () => {
    const profile = assertModelProfileKnownAndStartable(overviewBase, 'qwen36_35b_uncensored');
    expect(profile.id).toBe('qwen36_35b_uncensored');
  });
});
