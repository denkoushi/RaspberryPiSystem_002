import { describe, expect, it } from 'vitest';

import {
  buildLoadBalancingOverviewSessionContext,
  shouldResetLoadBalancingOverviewSession
} from '../loadBalancingOverviewSession';

describe('loadBalancingOverviewSession', () => {
  const base = buildLoadBalancingOverviewSessionContext('2026-04', 'device-a', 'A01\tB02');

  it('初回はセッション reset しない', () => {
    expect(shouldResetLoadBalancingOverviewSession(null, base)).toBe(false);
  });

  it('同値のセッションでは reset しない', () => {
    const same = buildLoadBalancingOverviewSessionContext('2026-04', 'device-a', 'A01\tB02');
    expect(shouldResetLoadBalancingOverviewSession(base, same)).toBe(false);
  });

  it('月・scope・超過資源集合のいずれかが変われば reset する', () => {
    expect(
      shouldResetLoadBalancingOverviewSession(
        base,
        buildLoadBalancingOverviewSessionContext('2026-05', 'device-a', 'A01\tB02')
      )
    ).toBe(true);
    expect(
      shouldResetLoadBalancingOverviewSession(
        base,
        buildLoadBalancingOverviewSessionContext('2026-04', 'device-b', 'A01\tB02')
      )
    ).toBe(true);
    expect(
      shouldResetLoadBalancingOverviewSession(
        base,
        buildLoadBalancingOverviewSessionContext('2026-04', 'device-a', 'A01')
      )
    ).toBe(true);
  });
});
