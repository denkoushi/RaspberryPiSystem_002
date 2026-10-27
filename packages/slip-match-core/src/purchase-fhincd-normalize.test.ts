import { describe, expect, it } from 'vitest';

import { normalizePurchaseFhinCdForScheduleLookup, stripTrailingNumericHyphenSuffixes } from './purchase-fhincd-normalize.js';

// The previous regex implementations, kept as the reference for unchanged results.
const oldLookup = (raw: string) => raw.trim().replace(/\([^)]*\)/g, '').trim();
const oldStrip = (code: string) => code.replace(/(-[0-9]+)+$/g, '').trim();

describe('purchase FHINCD normalize', () => {
  it('matches the previous regex results', () => {
    const samples = ['MD000552918(A)', ' MD1(A)(B) ', '(a(b)c', 'MD1(', 'MD1)', '((x)', '()', 'A(1)B(2', '',
      'MD1-001', 'MD1-001-1', 'MD1-SA', 'MD1-002T', '-001', 'MD1--001', 'MD1-', 'MD1-001 ', 'MD1 -001', '12-3', 'A-1-B-2'];
    for (const sample of samples) {
      expect(normalizePurchaseFhinCdForScheduleLookup(sample)).toBe(oldLookup(sample));
      expect(stripTrailingNumericHyphenSuffixes(sample)).toBe(oldStrip(sample));
    }
  });

  it('stays fast on inputs that made the regex backtrack', () => {
    const started = Date.now();
    normalizePurchaseFhinCdForScheduleLookup('('.repeat(100_000));
    stripTrailingNumericHyphenSuffixes(`${'-0'.repeat(50_000)}x`);
    expect(Date.now() - started).toBeLessThan(500);
  });
});
