import { describe, expect, it } from 'vitest';

import { phonePalletStartDate } from '../PalletVizPhoneView';

describe('phone pallet date', () => {
  it('formats supported display dates without inventing absent data', () => {
    expect(phonePalletStartDate('2026-10-08')).toBe('10/8');
    expect(phonePalletStartDate('2026/01/02')).toBe('1/2');
    expect(phonePalletStartDate('10/08')).toBe('10/8');
    expect(phonePalletStartDate(null)).toBeNull();
    expect(phonePalletStartDate('')).toBeNull();
    expect(phonePalletStartDate('未定')).toBe('未定');
  });
});
