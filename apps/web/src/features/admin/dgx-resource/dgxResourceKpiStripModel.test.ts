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
  it('3項目・キー順が安定（純メトリクス）', () => {
    const items = buildDgxResourceKpiStripItems(
      sampleKpis({
        gpuUtilPct: 40,
        gpuTemperatureC: 46,
        gpuPowerDrawW: 11,
        gpuPowerLimitW: 120,
        gpuName: 'NVIDIA GB10',
        driverVersion: '580.159.03',
        unifiedMemoryUsedGiB: 96,
        unifiedMemoryTotalGiB: 128,
        freeMemoryGiB: 28,
        policyLabel: '業務優先',
      })
    );
    expect(items.map((x) => x.key)).toEqual(['gpu', 'umem', 'free', 'gpu-temp', 'gpu-power']);
    expect(items[0]?.value).toBe('40%');
    expect(items[0]?.hint).toBe('NVIDIA GB10 / Driver 580.159.03');
    expect(items[1]?.value).toBe('96 / 128 GiB');
    expect(items[2]?.value).toBe('28 GiB');
    expect(items[3]?.value).toBe('46℃');
    expect(items[4]?.value).toBe('11 / 120 W');
  });

  it('GPU null はプレースホルダ', () => {
    const items = buildDgxResourceKpiStripItems(sampleKpis({}));
    expect(items[0]?.value).toBe('—');
    expect(items[0]?.bar.pct).toBeNull();
  });
});
