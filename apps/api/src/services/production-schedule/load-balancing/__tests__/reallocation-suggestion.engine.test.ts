import { describe, expect, it } from 'vitest';

import { computeLoadBalancingSuggestions } from '../reallocation-suggestion.engine.js';
import type { LoadBalancingRowCandidate } from '../types.js';

const row = (partial: Partial<LoadBalancingRowCandidate> & Pick<LoadBalancingRowCandidate, 'rowId' | 'resourceCd' | 'requiredMinutes'>): LoadBalancingRowCandidate => ({
  fseiban: 'S1',
  productNo: 'P1',
  fhincd: 'H1',
  fkojun: '1',
  ...partial
});

describe('computeLoadBalancingSuggestions', () => {
  it('余力がある移管先へルールに従って提案する', () => {
    const overviewResources = [
      { resourceCd: 'A', requiredMinutes: 200, availableMinutes: 100 },
      { resourceCd: 'B', requiredMinutes: 50, availableMinutes: 300 }
    ];
    const rows: LoadBalancingRowCandidate[] = [
      row({ rowId: 'r1', resourceCd: 'A', requiredMinutes: 80, fseiban: 'S1' })
    ];
    const classes = new Map<string, string>([
      ['A', 'G1'],
      ['B', 'G2']
    ]);
    const suggestions = computeLoadBalancingSuggestions({
      overviewResources,
      rows,
      classes,
      rules: [{ fromClassCode: 'G1', toClassCode: 'G2', priority: 1, enabled: true, efficiencyRatio: 1 }],
      maxSuggestions: 10
    });
    expect(suggestions).toHaveLength(1);
    expect(suggestions[0]?.resourceCdFrom).toBe('A');
    expect(suggestions[0]?.resourceCdTo).toBe('B');
    expect(suggestions[0]?.estimatedBurdenMinutesOnDestination).toBeCloseTo(80);
  });

  it('分類未定義の行はスキップする', () => {
    const suggestions = computeLoadBalancingSuggestions({
      overviewResources: [{ resourceCd: 'A', requiredMinutes: 200, availableMinutes: 50 }],
      rows: [row({ rowId: 'r1', resourceCd: 'A', requiredMinutes: 40 })],
      classes: new Map(),
      rules: [{ fromClassCode: 'G1', toClassCode: 'G2', priority: 1, enabled: true, efficiencyRatio: 1 }],
      maxSuggestions: 10
    });
    expect(suggestions).toHaveLength(0);
  });

  it('効率係数で移管先負荷が増える場合は余力が足りなければ提案しない', () => {
    const overviewResources = [
      { resourceCd: 'A', requiredMinutes: 200, availableMinutes: 100 },
      { resourceCd: 'B', requiredMinutes: 180, availableMinutes: 200 }
    ];
    const rows: LoadBalancingRowCandidate[] = [row({ rowId: 'r1', resourceCd: 'A', requiredMinutes: 50 })];
    const classes = new Map<string, string>([
      ['A', 'G1'],
      ['B', 'G2']
    ]);
    const suggestions = computeLoadBalancingSuggestions({
      overviewResources,
      rows,
      classes,
      rules: [{ fromClassCode: 'G1', toClassCode: 'G2', priority: 1, enabled: true, efficiencyRatio: 2 }],
      maxSuggestions: 10
    });
    expect(suggestions).toHaveLength(0);
  });

  it('overResourceFilter で対象資源を絞る', () => {
    const overviewResources = [
      { resourceCd: 'A', requiredMinutes: 200, availableMinutes: 50 },
      { resourceCd: 'X', requiredMinutes: 500, availableMinutes: 100 },
      { resourceCd: 'B', requiredMinutes: 0, availableMinutes: 400 }
    ];
    const rows: LoadBalancingRowCandidate[] = [
      row({ rowId: 'r-a', resourceCd: 'A', requiredMinutes: 40 }),
      row({ rowId: 'r-x', resourceCd: 'X', requiredMinutes: 90 })
    ];
    const classes = new Map<string, string>([
      ['A', 'G1'],
      ['X', 'G1'],
      ['B', 'G2']
    ]);
    const suggestions = computeLoadBalancingSuggestions({
      overviewResources,
      rows,
      classes,
      rules: [{ fromClassCode: 'G1', toClassCode: 'G2', priority: 1, enabled: true, efficiencyRatio: 1 }],
      maxSuggestions: 10,
      overResourceFilter: new Set(['X'])
    });
    expect(suggestions.length).toBeGreaterThan(0);
    expect(suggestions.every((s) => s.resourceCdFrom === 'X')).toBe(true);
  });
});
