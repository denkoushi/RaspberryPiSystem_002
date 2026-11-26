import { describe, expect, it } from 'vitest';

import { isFkojunstResourceSwapComplete, resolveFkojunstResourceSwapLoadResourceCd } from '../fkojunst-resource-swap-completion.policy.js';
import { isProductionScheduleExcludedCuttingResourceCd } from '../../policies/resource-category-policy.service.js';

const completedAt = new Date('2026-11-25T01:00:00Z');
const completed = { statusCode: 'C', sourceUpdatedAt: completedAt };
const ownR = { statusCode: 'R', sourceUpdatedAt: completedAt };
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

  it.each([0, -1])('accepts R with two winners and an own timestamp %i ms from C', (offset) => {
    expect(isFkojunstResourceSwapComplete({
      ...candidate, winnerCount: 2, own: { ...ownR, sourceUpdatedAt: new Date(completedAt.getTime() + offset) },
    })).toBe(true);
  });

  it.each(['O', 'P', 'S'])('blocks %s with two winners', (statusCode) => {
    expect(isFkojunstResourceSwapComplete({ ...candidate, winnerCount: 2, own: { ...ownR, statusCode } })).toBe(false);
  });

  const blockedCases: [string, Partial<Parameters<typeof isFkojunstResourceSwapComplete>[0]>][] = [
    ['an X on the other resource', { other: { ...completed, statusCode: 'X' } }],
    ['two winners', { winnerCount: 2 }],
    ['two other resources', { otherResourceCount: 2 }],
    ['an S on the original resource', { own: { statusCode: 'S', sourceUpdatedAt: completedAt } }],
    ['a newer own status', { own: { statusCode: 'R', sourceUpdatedAt: new Date(completedAt.getTime() + 1) } }],
    ['a newer R with two winners', { winnerCount: 2, own: { ...ownR, sourceUpdatedAt: new Date(completedAt.getTime() + 1) } }],
    ['two other resources with R and two winners', { winnerCount: 2, own: ownR, otherResourceCount: 2 }],
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

describe('resolveFkojunstResourceSwapLoadResourceCd', () => {
  const pending = { resourceCd: '503', statusCode: 'P', sourceUpdatedAt: completedAt };
  const eligible = { ...candidate, other: pending, isOtherResourceInMaster: true, isCompleted: false };

  it.each(['S', 'R', 'O', 'P'])('moves load for destination status %s', (statusCode) => {
    const input = { ...eligible, other: { ...pending, statusCode } };
    expect(resolveFkojunstResourceSwapLoadResourceCd(input)).toBe('503');
    expect(resolveFkojunstResourceSwapLoadResourceCd({ ...input, own: { statusCode: 'R', sourceUpdatedAt: completedAt } })).toBe('503');
  });

  const blocked: [string, Partial<Parameters<typeof resolveFkojunstResourceSwapLoadResourceCd>[0]>][] = [
    ['C', { other: { ...pending, statusCode: 'C' } }],
    ['X', { other: { ...pending, statusCode: 'X' } }],
    ['unknown status', { other: { ...pending, statusCode: 'Z' } }],
    ['two winners', { winnerCount: 2 }],
    ['two other resources', { otherResourceCount: 2 }],
    ['excluded original resource', { isOwnResourceExcluded: true }],
    ['excluded destination', { isOtherResourceExcluded: true }],
    ['destination missing from the master', { isOtherResourceInMaster: false }],
    ['S on the original resource', { own: { statusCode: 'S', sourceUpdatedAt: completedAt } }],
    ['newer own status', { own: { statusCode: 'P', sourceUpdatedAt: new Date(completedAt.getTime() + 1) } }],
    ['unknown own timestamp', { own: { statusCode: 'R', sourceUpdatedAt: null } }],
    ['unknown destination timestamp', { other: { ...pending, sourceUpdatedAt: null } }],
    ['completed row', { isCompleted: true }],
    ['removed destination', { other: undefined, otherResourceCount: 0 }],
  ];
  it.each(blocked)('returns NULL for %s', (_label, overrides) => {
    expect(resolveFkojunstResourceSwapLoadResourceCd({ ...eligible, ...overrides })).toBeNull();
  });
});
