import { describe, expect, it } from 'vitest';

import { resolveLoadBalancingResourceDisplayName } from '../resolveLoadBalancingResourceDisplayName';

describe('resolveLoadBalancingResourceDisplayName', () => {
  it('resourceNameMap から表示名を連結する', () => {
    expect(
      resolveLoadBalancingResourceDisplayName('587', {
        '587': ['FJV50/80']
      })
    ).toBe('FJV50/80');
  });

  it('名称が無いときは空文字', () => {
    expect(resolveLoadBalancingResourceDisplayName('999', {})).toBe('');
  });
});
