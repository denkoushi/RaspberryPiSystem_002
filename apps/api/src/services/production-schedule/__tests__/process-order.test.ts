import { describe, expect, it } from 'vitest';
import { isLaterProcessOrder } from '../process-order.js';

describe('isLaterProcessOrder', () => {
  it('treats numerically equal process orders as the same process', () => {
    expect(isLaterProcessOrder('010', '10')).toBe(false);
    expect(isLaterProcessOrder('10', '010')).toBe(false);
  });
  it('compares numeric process orders by value', () => {
    expect(isLaterProcessOrder('20', '010')).toBe(true);
    expect(isLaterProcessOrder('9', '10')).toBe(false);
  });
  it('falls back to string order for non-numeric values', () => {
    expect(isLaterProcessOrder('B', 'A')).toBe(true);
  });
  it.each([
    ['２０', '10', true], ['20', '１０', true], ['２０', '１０', true],
    ['９', '10', false], ['9', '１０', false], ['０１０', '10', false], ['10', '０１０', false]
  ] as const)('compares normalized numeric orders %s and %s', (candidate, base, expected) => {
    expect(isLaterProcessOrder(candidate, base)).toBe(expected);
  });
  it.each(['', ' ', '\t\u3000'])('excludes blank process orders (%j) on either side', (blank) => {
    for (const order of ['10', 'A', blank]) {
      expect(isLaterProcessOrder(blank, order)).toBe(false);
      expect(isLaterProcessOrder(order, blank)).toBe(false);
    }
  });
});
