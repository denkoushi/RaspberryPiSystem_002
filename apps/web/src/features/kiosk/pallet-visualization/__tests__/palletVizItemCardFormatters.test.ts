import { describe, expect, it } from 'vitest';

import { palletVizCopy } from '../copy';
import { formatPalletVizDisplayOrDash, formatPalletVizQuantityLabel } from '../palletVizItemCardFormatters';

describe('formatPalletVizQuantityLabel', () => {
  it('null / 非有限は em dash', () => {
    expect(formatPalletVizQuantityLabel(null)).toBe(palletVizCopy.emDash);
    expect(formatPalletVizQuantityLabel(undefined)).toBe(palletVizCopy.emDash);
    expect(formatPalletVizQuantityLabel(Number.NaN)).toBe(palletVizCopy.emDash);
  });

  it('数値を文字列化', () => {
    expect(formatPalletVizQuantityLabel(24)).toBe('24');
  });
});

describe('formatPalletVizDisplayOrDash', () => {
  it('空・空白は em dash', () => {
    expect(formatPalletVizDisplayOrDash('')).toBe(palletVizCopy.emDash);
    expect(formatPalletVizDisplayOrDash('  ')).toBe(palletVizCopy.emDash);
    expect(formatPalletVizDisplayOrDash(null)).toBe(palletVizCopy.emDash);
  });

  it('前後 trim して非空はそのまま', () => {
    expect(formatPalletVizDisplayOrDash('  x  ')).toBe('x');
  });
});
