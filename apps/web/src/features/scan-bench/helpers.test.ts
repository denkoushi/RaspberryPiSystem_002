import { BarcodeFormat } from '@zxing/library';
import { describe, expect, it } from 'vitest';

import { FORMAT_PAIRS, NATIVE_FORMATS, scanStats, supportsRequiredFormats, toNativeFormat, toZxingFormat, ZXING_FORMATS } from './helpers';

import type { ScanRecord } from './helpers';

const record = (elapsedMs: number, value: string | null = '123'): ScanRecord => ({ engine: 'zxing', quality: 'standard', elapsedMs, value, format: null });

describe('scan bench helpers', () => {
  it('handles empty and timeout-only samples without treating timeouts as successes', () => {
    expect(scanStats([])).toEqual({ count: 0, successes: 0, timeouts: 0, median: null, fastest: null, slowest: null });
    expect(scanStats([record(15000, null)])).toEqual({ count: 1, successes: 0, timeouts: 1, median: null, fastest: null, slowest: null });
  });
  it('calculates odd/even medians, min/max and timeout count without mutating records', () => {
    const records = [record(3000), record(1000), record(15000, null), record(2000)];
    expect(scanStats(records)).toEqual({ count: 4, successes: 3, timeouts: 1, median: 2000, fastest: 1000, slowest: 3000 });
    expect(scanStats([...records, record(4000)]).median).toBe(2500);
    expect(records[0].elapsedMs).toBe(3000);
  });
  it('maps exactly the production core formats plus QR in both directions', () => {
    expect(ZXING_FORMATS.map(toNativeFormat)).toEqual(NATIVE_FORMATS);
    expect(NATIVE_FORMATS).toEqual(['code_128', 'code_39', 'itf', 'ean_13', 'ean_8', 'upc_a', 'upc_e', 'qr_code']);
    for (const [zxing, native] of FORMAT_PAIRS) {
      expect(toZxingFormat(native)).toBe(zxing);
      expect(toNativeFormat(zxing)).toBe(native);
    }
    expect(toNativeFormat(BarcodeFormat.AZTEC)).toBeUndefined();
    expect(toZxingFormat('unknown')).toBeUndefined();
  });
  it('requires every format, allowing additional supported formats', () => {
    expect(supportsRequiredFormats([])).toBe(false);
    for (const missing of NATIVE_FORMATS) expect(supportsRequiredFormats(NATIVE_FORMATS.filter((format) => format !== missing))).toBe(false);
    expect(supportsRequiredFormats([...NATIVE_FORMATS, 'aztec'])).toBe(true);
  });
});
