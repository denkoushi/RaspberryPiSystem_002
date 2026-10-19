import { describe, expect, it } from 'vitest';

import { formatInventoryLabelNumber } from './item-inventory.js';

describe('formatInventoryLabelNumber', () => {
  it.each([
    [1, '0001'], [2, '0002'], [12, '0012'], [123, '0123'], [9999, '9999'], [10000, '10000'],
  ])('formats %i as %s', (number, expected) => {
    expect(formatInventoryLabelNumber(number)).toBe(expected);
  });
});
