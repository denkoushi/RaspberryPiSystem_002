import { describe, expect, it } from 'vitest';

import { buildDgxResourceRuntimeSummaryItems } from './dgxResourceRuntimeSummaryModel';

import type { DgxResourceRuntimeSummaryApi } from '../../../api/dgx-resource.types';

function sampleSummary(partial: Partial<DgxResourceRuntimeSummaryApi>): DgxResourceRuntimeSummaryApi {
  return {
    activeProfileId: 'business_qwen35_35b_gguf',
    activeProfileDisplayNameJa: '35B GGUF',
    activeBackend: 'green',
    businessReady: true,
    businessReadyDetailJa: '業務推論 Ready',
    policyMode: 'business_first',
    policyLabel: '業務優先',
    runtimeSource: 'model_profile_state',
    inferenceDegraded: false,
    ...partial,
  };
}

describe('buildDgxResourceRuntimeSummaryItems', () => {
  it('35B green 稼働', () => {
    const items = buildDgxResourceRuntimeSummaryItems(sampleSummary({}));
    expect(items.map((x) => x.key)).toEqual(['model', 'backend', 'ready', 'policy']);
    expect(items[0]?.value).toBe('35B GGUF');
    expect(items[1]?.value).toContain('green');
    expect(items[2]?.value).toBe('Ready');
  });

  it('27B blue Ready', () => {
    const items = buildDgxResourceRuntimeSummaryItems(
      sampleSummary({
        activeProfileId: 'business_qwen36_27b_nvfp4',
        activeProfileDisplayNameJa: '27B NVFP4',
        activeBackend: 'blue',
        businessReady: true,
      })
    );
    expect(items[1]?.value).toContain('blue');
    expect(items[2]?.value).toBe('Ready');
  });

  it('profile 未確定', () => {
    const items = buildDgxResourceRuntimeSummaryItems(
      sampleSummary({
        activeProfileId: null,
        activeProfileDisplayNameJa: null,
        activeBackend: null,
        businessReady: false,
        runtimeSource: 'unknown',
      })
    );
    expect(items[0]?.value).toBe('未ロード');
    expect(items[2]?.value).toBe('Not Ready');
  });
});
