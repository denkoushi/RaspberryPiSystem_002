import { describe, expect, it } from 'vitest';

import { stripSitePrefixFromDeviceLabel } from './manualOrderDeviceDisplayLabel';

describe('stripSitePrefixFromDeviceLabel', () => {
  it('removes leading "{siteKey} - " from label', () => {
    expect(stripSitePrefixFromDeviceLabel('第2工場', '第2工場 - kensakuMain')).toBe('kensakuMain');
  });

  it('returns label unchanged when siteKey is empty', () => {
    expect(stripSitePrefixFromDeviceLabel('', '第2工場 - kensakuMain')).toBe('第2工場 - kensakuMain');
  });

  it('returns empty when label is empty', () => {
    expect(stripSitePrefixFromDeviceLabel('第2工場', '')).toBe('');
  });

  it('does not strip when prefix does not match selected site', () => {
    expect(stripSitePrefixFromDeviceLabel('トークプラザ', '第2工場 - kensakuMain')).toBe('第2工場 - kensakuMain');
  });

  it('trims siteKey and label before matching', () => {
    expect(stripSitePrefixFromDeviceLabel('  第2工場  ', '  第2工場 - RoboDrill01  ')).toBe('RoboDrill01');
  });
});
