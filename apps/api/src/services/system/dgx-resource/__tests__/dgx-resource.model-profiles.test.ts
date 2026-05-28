import { describe, expect, it, vi } from 'vitest';

import {
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
    expect(overview.lastLoadedProfileId).toBeNull();
    expect(overview.errorMessageJa).toBeUndefined();
    expect(overview.available).toHaveLength(1);
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
        pendingProfileId: null,
        lastLoadedProfileId: null,
        available: [
          {
            id: 'business_qwen35_35b_gguf',
            displayNameJa: 'Qwen3.5 35B GGUF',
            backend: 'green',
            servedAlias: 'system-prod-primary',
            recommended: false,
            enabled: true,
            status: 'available',
            canonicalNames: [],
            legacyNames: [],
          },
        ],
      },
      'business_qwen35_35b_gguf'
    );

    expect(profile.id).toBe('business_qwen35_35b_gguf');
  });
});
