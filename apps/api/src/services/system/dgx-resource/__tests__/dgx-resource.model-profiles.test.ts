import { describe, expect, it, vi } from 'vitest';

import {
  fetchDgxModelProfilesOverview,
  fetchBusinessModelSwitchCapability,
  parseDgxActiveModelRuntimeState,
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


describe('business switch contract', () => {
  it.each([
    [200, { enabled: true, contractVersion: 1 }, true],
    [200, { enabled: false, contractVersion: 1 }, false],
    [200, { enabled: true, contractVersion: 2 }, false],
    [200, { enabled: 'true', contractVersion: 1 }, false],
    [404, {}, false], [503, {}, false],
  ])('capability status %s and body %j -> %s', async (status, body, enabled) => {
    const fetchImpl = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => Response.json(body, { status }));
    expect(await fetchBusinessModelSwitchCapability({ baseUrl: 'http://cp.test', sharedToken: 'business-principal',
      fetchImpl, timeoutMs: 1000 })).toBe(enabled);
    expect(String(fetchImpl.mock.calls[0]?.[0])).toBe('http://cp.test/system/business-model-switch-capability');
    expect(fetchImpl.mock.calls[0]?.[1]).toMatchObject({ headers: { 'X-LLM-Token': 'business-principal' } });
  });
  it('closes capability on unreachable, malformed or unauthenticated CP', async () => {
    for (const fetchImpl of [vi.fn(async () => { throw new Error('unreachable'); }),
      vi.fn(async () => new Response('not-json'))]) {
      expect(await fetchBusinessModelSwitchCapability({ baseUrl: 'http://cp.test', sharedToken: 't', fetchImpl, timeoutMs: 1000 })).toBe(false);
    }
    const fetchImpl = vi.fn();
    expect(await fetchBusinessModelSwitchCapability({ baseUrl: 'http://cp.test', fetchImpl, timeoutMs: 1000 })).toBe(false);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
  it('hides the new manifest when off and preserves DGX selection when on', async () => {
    const selected = 'business_deepseek_v41_flash_tp2';
    const fetchImpl = vi.fn(async () => Response.json({ activeProfileId: selected,
      profiles: [{ id: selected, displayNameJa: 'DeepSeek', backend: 'blue', enabled: true, status: 'available' }],
      state: { runtimeReadyCapabilities: ['text'], selectedBusinessProfileId: selected, selectionRevision: 7, businessTransition: 'ready' } }));
    const input = { baseUrl: 'http://cp.test', sharedToken: 't', fetchImpl, timeoutMs: 1000 };
    expect((await fetchDgxModelProfilesOverview(input)).available).toEqual([]);
    const overview = await fetchDgxModelProfilesOverview({ ...input, businessDeepseekSwitchEnabled: true });
    expect(overview.available.map((p) => p.id)).toEqual([selected]);
    expect(overview.activeRuntimeState).toMatchObject({ selectedBusinessProfileId: selected, selectionRevision: 7, businessTransition: 'ready' });
    expect(parseDgxActiveModelRuntimeState({ runtimeReadyCapabilities: ['text'] })).toEqual({ runtimeReadyCapabilities: ['text'], visionReadyReason: null });
  });
});
