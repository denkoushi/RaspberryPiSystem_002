import { describe, expect, it } from 'vitest';

import { fitRewriteFontSize } from './rewriteTextFontSize';

describe('fitRewriteFontSize', () => {
  it('fits the widest line to the erased width', () => {
    // "abcd" measures 2em, so 0.38 * 0.95 / 2 = 0.1805 of the page width.
    expect(fitRewriteFontSize('ab\nabcd', 0.38, 0.15, (line) => line.length / 2)).toBeCloseTo(0.1805);
  });

  it('stays near the height-based size when the width disagrees wildly', () => {
    expect(fitRewriteFontSize('a', 0.9, 0.02, () => 1)).toBeCloseTo(0.032);
    expect(fitRewriteFontSize('a', 0.001, 0.02, () => 1)).toBeCloseTo(0.01);
  });

  it('falls back to the height-based size when text cannot be measured', () => {
    expect(fitRewriteFontSize('abc', 0.3, 0.02, () => null)).toBe(0.02);
  });
});
