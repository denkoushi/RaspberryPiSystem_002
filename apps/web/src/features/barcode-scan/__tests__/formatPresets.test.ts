import { BarcodeFormat } from '@zxing/library';
import { describe, expect, it } from 'vitest';

import {
  BARCODE_FORMAT_PRESET_ALL_COMMON,
  BARCODE_FORMAT_PRESET_ONE_DIMENSIONAL,
  BARCODE_FORMAT_PRESET_PURCHASE_ORDER,
} from '../formatPresets';

describe('formatPresets', () => {
  it('一次元プリセットに QR を含まない', () => {
    expect(BARCODE_FORMAT_PRESET_ONE_DIMENSIONAL).not.toContain(BarcodeFormat.QR_CODE);
    expect(BARCODE_FORMAT_PRESET_ONE_DIMENSIONAL).not.toContain(BarcodeFormat.DATA_MATRIX);
    expect(BARCODE_FORMAT_PRESET_ONE_DIMENSIONAL).toContain(BarcodeFormat.CODE_128);
  });

  it('購買照会プリセットは一次元の真部分集合で主要形式に絞る', () => {
    expect(BARCODE_FORMAT_PRESET_PURCHASE_ORDER.length).toBeLessThan(
      BARCODE_FORMAT_PRESET_ONE_DIMENSIONAL.length
    );
    for (const f of BARCODE_FORMAT_PRESET_PURCHASE_ORDER) {
      expect(BARCODE_FORMAT_PRESET_ONE_DIMENSIONAL).toContain(f);
    }
    expect(BARCODE_FORMAT_PRESET_PURCHASE_ORDER).not.toContain(BarcodeFormat.CODABAR);
    expect(BARCODE_FORMAT_PRESET_PURCHASE_ORDER).toContain(BarcodeFormat.CODE_128);
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
