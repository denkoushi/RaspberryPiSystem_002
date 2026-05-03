import { describe, expect, it } from 'vitest';

import { buildDgxResourceKpiStripItems, formatUnifiedMemDisplay } from './dgxResourceKpiStripModel';

import type { DgxResourceKpis } from '../../../api/dgx-resource.types';

function sampleKpis(partial: Partial<DgxResourceKpis>): DgxResourceKpis {
  return {
    gpuUtilPct: null,
    unifiedMemoryUsedGiB: null,
    unifiedMemoryTotalGiB: null,
    freeMemoryGiB: null,
    policyMode: 'business_first',
    policyLabel: '業務優先',
    ...partial,
  };
}

describe('formatUnifiedMemDisplay', () => {
  it('結合両方あり', () => {
    expect(formatUnifiedMemDisplay(96, 128)).toBe('96 / 128 GiB');
  });
  it('used のみ', () => {
    expect(formatUnifiedMemDisplay(12, null)).toBe('12 GiB');
  });
  it('データなし', () => {
    expect(formatUnifiedMemDisplay(null, null)).toBe('—');
  });
});

describe('buildDgxResourceKpiStripItems', () => {
  it('4項目・キー順が安定', () => {
    const items = buildDgxResourceKpiStripItems(
      sampleKpis({
        gpuUtilPct: 40,
        unifiedMemoryUsedGiB: 96,
        unifiedMemoryTotalGiB: 128,
        freeMemoryGiB: 28,
        policyLabel: '業務優先',
      })
    );
    expect(items.map((x) => x.key)).toEqual(['gpu', 'umem', 'free', 'pol']);
    expect(items[0]?.value).toBe('40%');
    expect(items[1]?.value).toBe('96 / 128 GiB');
    expect(items[2]?.value).toBe('28 GiB');
    expect(items[3]?.value).toBe('業務優先');
  });

  it('GPU null はプレースホルダ', () => {
    const items = buildDgxResourceKpiStripItems(sampleKpis({}));
    expect(items[0]?.value).toBe('—');
    expect(items[0]?.bar.pct).toBeNull();
  });
});
