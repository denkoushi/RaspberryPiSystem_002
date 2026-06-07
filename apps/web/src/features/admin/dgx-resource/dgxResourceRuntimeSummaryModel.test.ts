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
    resourceOwner: 'business',
    resourceOwnerLabelJa: '業務',
    resourceStateStatus: 'preparing',
    resourceStateDetailJa: '35B GGUF（preparing / post_only）',
    ...partial,
  };
}

describe('buildDgxResourceRuntimeSummaryItems', () => {
  it('35B green 稼働', () => {
    const items = buildDgxResourceRuntimeSummaryItems(sampleSummary({}));
    expect(items.map((x) => x.key)).toEqual(['owner', 'model', 'backend', 'ready', 'policy']);
    expect(items[0]?.value).toBe('業務');
    expect(items[1]?.value).toBe('35B GGUF');
    expect(items[2]?.value).toContain('green');
    expect(items[3]?.value).toBe('Ready');
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
    expect(items[2]?.value).toContain('blue');
    expect(items[3]?.value).toBe('Ready');
  });

  it('includes Pi5 business intent when present', () => {
    const items = buildDgxResourceRuntimeSummaryItems(
      sampleSummary({
        businessRuntimeIntentProfileId: 'business_qwen35_35b_gguf',
        businessRuntimeIntentSource: 'orchestration',
        businessRuntimeIntentAlignedWithActive: true,
      })
    );
    expect(items.some((i) => i.key === 'intent')).toBe(true);
    expect(items.find((i) => i.key === 'intent')?.value).toBe('business_qwen35_35b_gguf');
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
    expect(items[1]?.value).toBe('未ロード');
    expect(items[3]?.value).toBe('Not Ready');
  });
});
