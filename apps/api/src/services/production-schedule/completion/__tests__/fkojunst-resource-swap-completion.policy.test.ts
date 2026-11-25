import { describe, expect, it } from 'vitest';

import { isFkojunstResourceSwapComplete } from '../fkojunst-resource-swap-completion.policy.js';
import { isProductionScheduleExcludedCuttingResourceCd } from '../../policies/resource-category-policy.service.js';

const completedAt = new Date('2026-11-25T01:00:00Z');
const completed = { statusCode: 'C', sourceUpdatedAt: completedAt };
const candidate = {
  winnerCount: 1,
  otherResourceCount: 1,
  own: undefined,
  other: completed,
  isOwnResourceExcluded: false,
  isOtherResourceExcluded: false,
};

describe('isFkojunstResourceSwapComplete', () => {
  it('accepts C without an own status or with a non-S own status at the same time', () => {
    expect(isFkojunstResourceSwapComplete(candidate)).toBe(true);
    expect(isFkojunstResourceSwapComplete({ ...candidate, own: { statusCode: 'R', sourceUpdatedAt: completedAt } })).toBe(true);
  });

  const blockedCases: [string, Partial<Parameters<typeof isFkojunstResourceSwapComplete>[0]>][] = [
    ['an X on the other resource', { other: { ...completed, statusCode: 'X' } }],
    ['two winners', { winnerCount: 2 }],
    ['two other resources', { otherResourceCount: 2 }],
    ['an S on the original resource', { own: { statusCode: 'S', sourceUpdatedAt: completedAt } }],
    ['a newer own status', { own: { statusCode: 'R', sourceUpdatedAt: new Date(completedAt.getTime() + 1) } }],
    ['an unparseable other timestamp', { other: { ...completed, sourceUpdatedAt: null } }],
    ['an unparseable own timestamp', { own: { statusCode: 'R', sourceUpdatedAt: null } }],
    ['an excluded destination', { isOtherResourceExcluded: true }],
  ];
  it.each(blockedCases)('blocks %s', (_label, overrides) => {
    expect(isFkojunstResourceSwapComplete({ ...candidate, ...overrides })).toBe(false);
  });

  it('blocks KUMITATE1 -> 301 even when 301 is completed', () => {
    const policy = { grindingResourceCds: [], cuttingExcludedResourceCds: ['10', 'KUMITATE1', 'KUMITATE2', 'MSZ'] };
    expect(isFkojunstResourceSwapComplete({
      ...candidate,
      isOwnResourceExcluded: isProductionScheduleExcludedCuttingResourceCd('KUMITATE1', policy),
      isOtherResourceExcluded: isProductionScheduleExcludedCuttingResourceCd('301', policy),
    })).toBe(false);
  });

  it('no longer completes when the other resource changes from C to P', () => {
    expect(isFkojunstResourceSwapComplete(candidate)).toBe(true);
    expect(isFkojunstResourceSwapComplete({ ...candidate, other: { ...completed, statusCode: 'P' } })).toBe(false);
  });
});
