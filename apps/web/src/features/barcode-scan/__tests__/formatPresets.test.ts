import { BarcodeFormat } from '@zxing/library';
import { describe, expect, it } from 'vitest';

import { BARCODE_FORMAT_PRESET_ALL_COMMON, BARCODE_FORMAT_PRESET_ONE_DIMENSIONAL } from '../formatPresets';

describe('formatPresets', () => {
  it('一次元プリセットに QR を含まない', () => {
    expect(BARCODE_FORMAT_PRESET_ONE_DIMENSIONAL).not.toContain(BarcodeFormat.QR_CODE);
    expect(BARCODE_FORMAT_PRESET_ONE_DIMENSIONAL).not.toContain(BarcodeFormat.DATA_MATRIX);
    expect(BARCODE_FORMAT_PRESET_ONE_DIMENSIONAL).toContain(BarcodeFormat.CODE_128);
  });

  it('汎用プリセットは一次元を包含し QR も含む', () => {
    expect(BARCODE_FORMAT_PRESET_ALL_COMMON.length).toBeGreaterThan(
      BARCODE_FORMAT_PRESET_ONE_DIMENSIONAL.length
    );
    expect(BARCODE_FORMAT_PRESET_ALL_COMMON).toContain(BarcodeFormat.QR_CODE);
    for (const f of BARCODE_FORMAT_PRESET_ONE_DIMENSIONAL) {
      expect(BARCODE_FORMAT_PRESET_ALL_COMMON).toContain(f);
    }
  });
});
