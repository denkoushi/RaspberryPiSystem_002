import { describe, expect, it } from 'vitest';

import { ALLOWED_DERIVATIVE_WIDTHS, parseDerivativeWidth } from '../part-measurement-drawing-storage.js';

describe('parseDerivativeWidth', () => {
  it('allows 1280/1920/2560/4096 only', () => {
    expect([...ALLOWED_DERIVATIVE_WIDTHS]).toEqual([1280, 1920, 2560, 4096]);
    expect(parseDerivativeWidth('4096')).toBe(4096);
    expect(parseDerivativeWidth(2560)).toBe(2560);
    expect(parseDerivativeWidth('3000')).toBeNull();
    expect(parseDerivativeWidth('8192')).toBeNull();
    expect(parseDerivativeWidth(undefined)).toBeNull();
    expect(parseDerivativeWidth('abc')).toBeNull();
  });
});
