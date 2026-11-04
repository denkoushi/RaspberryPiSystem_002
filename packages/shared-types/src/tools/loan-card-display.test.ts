import { describe, expect, it } from 'vitest';

import { normalizeFastenerText } from '../torque-wrenches/index.js';

import { formatClientDeviceLocationLabel } from './client-device-location.js';
import { PHOTO_LOAN_CARD_PRIMARY_LABEL, resolvePhotoLoanToolDisplayLabel } from './loan-card-display.js';

describe('resolvePhotoLoanToolDisplayLabel', () => {
  it('prefers the trimmed human review label over the VLM label', () => {
    expect(
      resolvePhotoLoanToolDisplayLabel({ humanDisplayName: ' ノギス ', vlmDisplayName: 'スパナ', fallbackLabel: PHOTO_LOAN_CARD_PRIMARY_LABEL })
    ).toBe('ノギス');
  });

  it('falls back to VLM when the human label is blank or null', () => {
    expect(resolvePhotoLoanToolDisplayLabel({ humanDisplayName: '   ', vlmDisplayName: ' スパナ ', fallbackLabel: 'x' })).toBe('スパナ');
    expect(resolvePhotoLoanToolDisplayLabel({ humanDisplayName: null, vlmDisplayName: 'スパナ', fallbackLabel: 'x' })).toBe('スパナ');
  });

  it('uses the fallback label as-is when neither label has content', () => {
    expect(resolvePhotoLoanToolDisplayLabel({ humanDisplayName: '', vlmDisplayName: undefined, fallbackLabel: PHOTO_LOAN_CARD_PRIMARY_LABEL })).toBe(
      '撮影mode'
    );
    expect(resolvePhotoLoanToolDisplayLabel({ fallbackLabel: ' raw ' })).toBe(' raw ');
  });
});

describe('formatClientDeviceLocationLabel', () => {
  it('returns the trimmed location or "-" when empty', () => {
    expect(formatClientDeviceLocationLabel(' 第2工場 ')).toBe('第2工場');
    expect(formatClientDeviceLocationLabel('   ')).toBe('-');
    expect(formatClientDeviceLocationLabel('')).toBe('-');
    expect(formatClientDeviceLocationLabel(null)).toBe('-');
    expect(formatClientDeviceLocationLabel(undefined)).toBe('-');
  });
});

describe('normalizeFastenerText', () => {
  it('applies NFKC, removes all whitespace and upper-cases', () => {
    expect(normalizeFastenerText(' ｍ８ × ２０ ')).toBe('M8×20');
    expect(normalizeFastenerText('m 10　p1.25')).toBe('M10P1.25');
    expect(normalizeFastenerText('')).toBe('');
  });
});
