import { describe, expect, it } from 'vitest';

import { mergeVisibleResourceOrder } from './mergeVisibleResourceOrder';

describe('mergeVisibleResourceOrder', () => {
  it.each([
    [['hidden', 'a', 'b'], ['hidden', 'b', 'a']],
    [['a', 'hidden', 'b'], ['b', 'hidden', 'a']],
    [['a', 'b', 'hidden'], ['b', 'a', 'hidden']],
    [['a', 'b'], ['b', 'a']],
    [['start', 'a', 'middle', 'b', 'end'], ['start', 'b', 'middle', 'a', 'end']]
  ])('preserves hidden slots in %j', (fullOrder, expected) => {
    expect(mergeVisibleResourceOrder(fullOrder, ['b', 'a'])).toEqual(expected);
    expect(fullOrder.indexOf('a')).toBeLessThan(fullOrder.indexOf('b'));
  });
});
