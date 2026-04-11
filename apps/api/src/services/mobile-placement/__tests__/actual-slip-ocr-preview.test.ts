import { describe, expect, it } from 'vitest';

import { buildActualSlipOcrPreviewSafe } from '../actual-slip-ocr-preview.js';

describe('buildActualSlipOcrPreviewSafe', () => {
  it('dedupes identical digit and aux strings (stub OCR triple-call)', () => {
    const s = '0123456789';
    expect(buildActualSlipOcrPreviewSafe(s, s)).toBe('0123456789');
  });

  it('joins distinct strings', () => {
    expect(buildActualSlipOcrPreviewSafe('0002178005', 'BE1N9321')).toBe('0002178005 BE1N9321');
  });

  it('returns null when both empty', () => {
    expect(buildActualSlipOcrPreviewSafe('  ', '')).toBeNull();
  });
});
