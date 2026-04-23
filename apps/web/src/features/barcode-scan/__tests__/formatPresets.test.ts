import { BarcodeFormat } from '@zxing/library';
import { describe, expect, it } from 'vitest';

import {
  BARCODE_FORMAT_PRESET_ALL_COMMON,
  BARCODE_FORMAT_PRESET_ONE_DIMENSIONAL,
  BARCODE_FORMAT_PRESET_ONE_DIMENSIONAL_CORE,
  BARCODE_FORMAT_PRESET_PURCHASE_ORDER,
} from '../formatPresets';
import {
  BARCODE_READER_OPTIONS_KIOSK_CONSERVATIVE,
  BARCODE_READER_OPTIONS_KIOSK_DEFAULT,
} from '../readerOptionPresets';

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

  it('モバイル向けコア一次元プリセットは広域一次元の部分集合', () => {
    expect(BARCODE_FORMAT_PRESET_ONE_DIMENSIONAL_CORE.length).toBeLessThan(
      BARCODE_FORMAT_PRESET_ONE_DIMENSIONAL.length
    );
    for (const f of BARCODE_FORMAT_PRESET_ONE_DIMENSIONAL_CORE) {
      expect(BARCODE_FORMAT_PRESET_ONE_DIMENSIONAL).toContain(f);
    }
    expect(BARCODE_FORMAT_PRESET_ONE_DIMENSIONAL_CORE).toContain(BarcodeFormat.CODE_128);
    expect(BARCODE_FORMAT_PRESET_ONE_DIMENSIONAL_CORE).not.toContain(BarcodeFormat.CODABAR);
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

  it('キオスク向け reader options は短い再試行間隔を使う', () => {
    expect(BARCODE_READER_OPTIONS_KIOSK_DEFAULT).toEqual({
      timeBetweenScansMillis: 220,
      timeBetweenDecodingAttempts: 120,
    });
  });

  it('要領書向け conservative は zxing 既定の間隔に合わせる', () => {
    expect(BARCODE_READER_OPTIONS_KIOSK_CONSERVATIVE).toEqual({
      timeBetweenScansMillis: 400,
      timeBetweenDecodingAttempts: 200,
    });
  });
});
