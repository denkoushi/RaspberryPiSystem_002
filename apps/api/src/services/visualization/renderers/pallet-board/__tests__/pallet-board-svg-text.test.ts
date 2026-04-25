import { describe, expect, it } from 'vitest';
import { ellipsizeToMaxChars, estimateMaxCharsForLine } from '../pallet-board-svg-text.js';

describe('pallet-board-svg-text', () => {
  it('estimateMaxCharsForLine scales with width and font', () => {
    expect(estimateMaxCharsForLine(200, 10)).toBeGreaterThan(estimateMaxCharsForLine(100, 10));
    expect(estimateMaxCharsForLine(100, 20)).toBeLessThan(estimateMaxCharsForLine(100, 10));
  });

  it('ellipsizeToMaxChars leaves short strings unchanged', () => {
    expect(ellipsizeToMaxChars('abc', 5)).toBe('abc');
  });

  it('ellipsizeToMaxChars truncates with ellipsis', () => {
    const long = 'あ'.repeat(30);
    const out = ellipsizeToMaxChars(long, 8);
    expect(out.length).toBe(8);
    expect(out.endsWith('…')).toBe(true);
  });
});
