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

    expect(overview.status).toBe('ok');
    expect(overview.activeProfileId).toBeNull();
    expect(overview.activeStateBackend).toBeNull();
    expect(overview.lastLoadedProfileId).toBeNull();
    expect(overview.errorMessageJa).toBeUndefined();
    expect(overview.available).toHaveLength(1);
    expect(overview.businessReturnSelectable).toHaveLength(1);
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
        ],
      }),
    })) as typeof fetch;

    const overview = await fetchDgxModelProfilesOverview({
      baseUrl: 'http://127.0.0.1:38081',
      sharedToken: 'x'.repeat(32),
      fetchImpl,
      timeoutMs: 3000,
    });

    expect(overview.available).toHaveLength(2);
    expect(overview.businessReturnSelectable.map((p) => p.id)).toEqual(['business_qwen36_27b_nvfp4']);
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
