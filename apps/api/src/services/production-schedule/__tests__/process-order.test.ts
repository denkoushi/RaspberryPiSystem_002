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
  it('falls back to string order for non-numeric or blank values', () => {
    expect(isLaterProcessOrder('B', 'A')).toBe(true);
    expect(isLaterProcessOrder('', '10')).toBe(false);
  });
});
