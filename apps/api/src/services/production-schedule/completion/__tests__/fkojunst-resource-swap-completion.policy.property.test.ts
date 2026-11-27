import * as fc from 'fast-check';
import { expect, it } from 'vitest';

import { isFkojunstResourceSwapComplete, resolveFkojunstResourceSwapLoadResourceCd } from '../fkojunst-resource-swap-completion.policy.js';

it('keeps the single-winner limit without an own status', () => {
  fc.assert(fc.property(fc.integer({ min: 2, max: 1000 }), fc.date({ noInvalidDate: true }), (count, date) => {
    const candidate = {
      winnerCount: 1, otherResourceCount: 1, own: undefined, other: { statusCode: 'C', sourceUpdatedAt: date },
      isOwnResourceExcluded: false, isOtherResourceExcluded: false,
    };
    expect(isFkojunstResourceSwapComplete(candidate)).toBe(true);
    expect(isFkojunstResourceSwapComplete({ ...candidate, winnerCount: count })).toBe(false);
    expect(isFkojunstResourceSwapComplete({ ...candidate, otherResourceCount: count })).toBe(false);
  }));
});

it('lifts only the winner count limit for R at or before C', () => {
  fc.assert(fc.property(fc.integer({ min: 2, max: 1000 }), fc.integer(), fc.nat(),
    (count, timestamp, offset) => {
      const candidate = {
        winnerCount: count, otherResourceCount: 1,
        own: { statusCode: 'R', sourceUpdatedAt: new Date(timestamp - offset) },
        other: { statusCode: 'C', sourceUpdatedAt: new Date(timestamp) },
        isOwnResourceExcluded: false, isOtherResourceExcluded: false,
      };
      expect(isFkojunstResourceSwapComplete(candidate)).toBe(true);
      expect(isFkojunstResourceSwapComplete({ ...candidate, otherResourceCount: count })).toBe(false);
      expect(isFkojunstResourceSwapComplete({ ...candidate, own: { ...candidate.own, sourceUpdatedAt: new Date(timestamp + offset + 1) } })).toBe(false);
      for (const statusCode of ['O', 'P', 'S']) {
        expect(isFkojunstResourceSwapComplete({ ...candidate, own: { ...candidate.own, statusCode } })).toBe(false);
      }
    }));
});

it('keeps ambiguous processes from moving load for any unfinished destination status', () => {
  fc.assert(fc.property(fc.integer({ min: 2, max: 1000 }), fc.date({ noInvalidDate: true }),
    fc.constantFrom('S', 'R', 'O', 'P'), (count, sourceUpdatedAt, statusCode) => {
      const candidate = {
        winnerCount: 1, otherResourceCount: 1, own: { statusCode: 'R', sourceUpdatedAt },
        other: { resourceCd: '503', statusCode, sourceUpdatedAt },
        isOwnResourceExcluded: false, isOtherResourceExcluded: false, isOtherResourceInMaster: true, isCompleted: false,
      };
      expect(resolveFkojunstResourceSwapLoadResourceCd(candidate)).toBe('503');
      expect(resolveFkojunstResourceSwapLoadResourceCd({ ...candidate, winnerCount: count })).toBeNull();
      expect(resolveFkojunstResourceSwapLoadResourceCd({ ...candidate, otherResourceCount: count })).toBeNull();
    }));
});
