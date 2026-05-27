import { describe, expect, it } from 'vitest';

import {
  mergeLoadBalancingItemsByResourceCd,
  mergeLoadBalancingTransferRules,
  usedSharedFallbackByResourceCd,
  usedSharedFallbackByTransferRule
} from '../load-balancing-settings-merge.js';

describe('load-balancing-settings-merge', () => {
  it('site の resourceCd が shared より優先される', () => {
    const merged = mergeLoadBalancingItemsByResourceCd(
      [{ resourceCd: '021', baseAvailableMinutes: 100 } as { resourceCd: string; baseAvailableMinutes: number }],
      [{ resourceCd: '021', baseAvailableMinutes: 999 }, { resourceCd: '033', baseAvailableMinutes: 50 }]
    );

    expect(merged).toEqual([
      { resourceCd: '021', baseAvailableMinutes: 100 },
      { resourceCd: '033', baseAvailableMinutes: 50 }
    ]);
  });

  it('shared のみのとき site リクエスト相当でも全件補完される', () => {
    const merged = mergeLoadBalancingItemsByResourceCd(
      [],
      [
        { resourceCd: '021', baseAvailableMinutes: 100 },
        { resourceCd: '033', baseAvailableMinutes: 50 }
      ]
    );

    expect(merged).toHaveLength(2);
    expect(usedSharedFallbackByResourceCd([], merged)).toBe(true);
  });

  it('site に無い resourceCd だけ shared から補完される', () => {
    const siteItems = [{ resourceCd: '021', baseAvailableMinutes: 100 }];
    const merged = mergeLoadBalancingItemsByResourceCd(siteItems, [{ resourceCd: '033', baseAvailableMinutes: 50 }]);

    expect(merged).toEqual([
      { resourceCd: '021', baseAvailableMinutes: 100 },
      { resourceCd: '033', baseAvailableMinutes: 50 }
    ]);
    expect(usedSharedFallbackByResourceCd(siteItems, merged)).toBe(true);
  });

  it('移管ルールは複合キーで site 優先する', () => {
    const siteItems = [
      {
        fromClassCode: 'G1',
        toClassCode: 'G2',
        priority: 1,
        enabled: true,
        efficiencyRatio: 1
      }
    ];
    const sharedItems = [
      {
        fromClassCode: 'G1',
        toClassCode: 'G2',
        priority: 1,
        enabled: false,
        efficiencyRatio: 2
      },
      {
        fromClassCode: 'G1',
        toClassCode: 'G3',
        priority: 2,
        enabled: true,
        efficiencyRatio: 1
      }
    ];

    const merged = mergeLoadBalancingTransferRules(siteItems, sharedItems);

    expect(merged).toHaveLength(2);
    expect(merged[0]?.enabled).toBe(true);
    expect(merged[1]?.toClassCode).toBe('G3');
    expect(usedSharedFallbackByTransferRule(siteItems, merged)).toBe(true);
  });
});
