import * as fc from 'fast-check';
import { expect, it } from 'vitest';

import { isFkojunstResourceSwapComplete } from '../fkojunst-resource-swap-completion.policy.js';

it('extra winners or resources cannot turn an ambiguous process into a completion', () => {
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
