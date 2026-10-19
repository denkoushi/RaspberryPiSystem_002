import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { waitBusinessReadiness, type BusinessReadinessSnapshot } from '../dgx-resource.scenario-readiness.js';

function snapshot(): BusinessReadinessSnapshot {
  return {
    llmState: 'ok',
    modelProfiles: {
      configured: true, status: 'ok', activeProfileId: 'a', activeStateBackend: 'blue', activeRuntimeState: null,
      businessReturnSelectable: [], pendingProfileId: null, lastLoadedProfileId: 'a', resourceState: null,
      available: [{ id: 'a', displayNameJa: 'モデル A', backend: 'blue', servedAlias: 'business', recommended: true,
        businessOrchestrationEligible: true, enabled: true, status: 'available', canonicalNames: [], legacyNames: [] }],
    },
  };
}
beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('business readiness', () => {
  it('requires two consecutive ready observations and retries at most once', async () => {
    const ready = snapshot();
    const notReady = { ...ready, llmState: 'down' as const };
    const collect = vi.fn().mockResolvedValueOnce(ready).mockResolvedValueOnce(notReady).mockResolvedValue(ready);
    const retryStart = vi.fn();
    const result = waitBusinessReadiness({ collect, modelProfileId: 'a', timeoutMs: 100, pollIntervalMs: 10, retryStart });
    await vi.advanceTimersByTimeAsync(30);
    expect(await result).toBe(true);
    expect(collect).toHaveBeenCalledTimes(4);
    expect(retryStart).toHaveBeenCalledTimes(1);
  });
  it.each(['profile', 'backend', 'vision', 'catalog'] as const)('does not accept incorrect %s readiness', async (field) => {
    const state = snapshot();
    if (field === 'profile') state.modelProfiles.activeProfileId = 'b';
    if (field === 'backend') state.modelProfiles.activeStateBackend = 'green';
    if (field === 'vision') state.modelProfiles.available[0]!.declaredCapabilities = ['vision'];
    if (field === 'catalog') state.modelProfiles.status = 'degraded';
    const retryStart = vi.fn();
    const result = waitBusinessReadiness({ collect: async () => state, modelProfileId: 'a', timeoutMs: 30, pollIntervalMs: 10, retryStart });
    await vi.advanceTimersByTimeAsync(30);
    expect(await result).toBe(false);
    expect(retryStart).toHaveBeenCalledTimes(1);
  });
  it('accepts matching runtime vision capabilities', async () => {
    const state = snapshot();
    state.modelProfiles.available[0]!.declaredCapabilities = ['vision'];
    state.modelProfiles.activeRuntimeState = { runtimeReadyCapabilities: ['vision'], visionReadyReason: null };
    const retryStart = vi.fn();
    const result = waitBusinessReadiness({ collect: async () => state, modelProfileId: 'a', timeoutMs: 100, pollIntervalMs: 10, retryStart });
    await vi.advanceTimersByTimeAsync(10);
    expect(await result).toBe(true);
    expect(retryStart).not.toHaveBeenCalled();
  });
});
