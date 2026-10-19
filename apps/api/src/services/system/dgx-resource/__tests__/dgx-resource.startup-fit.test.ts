import { describe, expect, it } from 'vitest';

import { buildDgxModelStartupFit } from '../dgx-resource.startup-fit.js';
import type { DgxBusinessModelProfile } from '../dgx-resource.model-profiles.js';

const profile: DgxBusinessModelProfile = {
  id: 'candidate', displayNameJa: 'モデル', backend: 'blue', servedAlias: 'business',
  recommended: false, businessOrchestrationEligible: true, enabled: true, status: 'available',
  canonicalNames: [], legacyNames: [], runtimeProfile: { engine: 'vllm', vllm: { gpuMemoryUtilization: 0.5 } },
};
const active: DgxBusinessModelProfile = { ...profile, id: 'active', runtimeProfile: { engine: 'vllm', vllm: { gpuMemoryUtilization: 0.6 } } };

describe('switch startup fit', () => {
  it('always fits the active model, even without metrics or with another engine', () => {
    expect(buildDgxModelStartupFit(profile, { startupFreeMemoryGiB: 0, unifiedMemoryTotalGiB: 100 }, profile, profile.id)?.status).toBe('fits');
    expect(buildDgxModelStartupFit({ ...profile, runtimeProfile: { engine: 'llama.cpp' } }, undefined, profile, profile.id)?.status).toBe('fits');
  });
  it('adds measured process memory to startup free space before switching', () => {
    expect(buildDgxModelStartupFit(profile, { startupFreeMemoryGiB: 10, unifiedMemoryTotalGiB: 100, gpuProcessMemoryUsedGiB: 45 }, active, active.id))
      .toMatchObject({ status: 'fits', requiredGiB: 50, availableGiB: 55 });
  });
  it('falls back to the active model estimate, not the selected model estimate', () => {
    expect(buildDgxModelStartupFit(profile, { systemMemoryAvailableGiB: 5, unifiedMemoryTotalGiB: 100 }, active, active.id))
      .toMatchObject({ status: 'fits', requiredGiB: 50, availableGiB: 65 });
  });
  it('uses free space alone when stopped, even if process metrics are reported', () => {
    expect(buildDgxModelStartupFit(profile, { freeMemoryGiB: 10, gpuProcessMemoryUsedGiB: 80, unifiedMemoryTotalGiB: 100 }))
      .toMatchObject({ status: 'insufficient', requiredGiB: 50, availableGiB: 10 });
  });
  it('keeps missing available or required estimates unknown', () => {
    expect(buildDgxModelStartupFit(profile, { unifiedMemoryTotalGiB: 100 }, active, active.id))
      .toMatchObject({ status: 'unknown', requiredGiB: 50 });
    expect(buildDgxModelStartupFit(profile, { freeMemoryGiB: 10 }, active, active.id)?.availableGiB).toBeUndefined();
    expect(buildDgxModelStartupFit({ ...profile, runtimeProfile: undefined }, { freeMemoryGiB: 10 })?.requiredGiB).toBeUndefined();
  });
  it('keeps a zero measured process size and compares unrounded values', () => {
    expect(buildDgxModelStartupFit(profile, { startupFreeMemoryGiB: 49.99, gpuProcessMemoryUsedGiB: 0, unifiedMemoryTotalGiB: 100 }, active, active.id))
      .toMatchObject({ status: 'insufficient', availableGiB: 49.99 });
  });
});
