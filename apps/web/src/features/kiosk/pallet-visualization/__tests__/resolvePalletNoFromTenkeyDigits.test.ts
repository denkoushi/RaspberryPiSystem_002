import { describe, expect, it } from 'vitest';

import { resolvePalletNoFromTenkeyDigits } from '../resolvePalletNoFromTenkeyDigits';

describe('resolvePalletNoFromTenkeyDigits', () => {
  it('1桁 1〜9', () => {
    expect(resolvePalletNoFromTenkeyDigits([5], 28)).toEqual({ ok: true, value: 5 });
  });

  it('1桁の0は不可', () => {
    expect(resolvePalletNoFromTenkeyDigits([0], 10).ok).toBe(false);
  });

  it('2桁 10', () => {
    expect(resolvePalletNoFromTenkeyDigits([1, 0], 28)).toEqual({ ok: true, value: 10 });
  });

  it('2桁 28', () => {
    expect(resolvePalletNoFromTenkeyDigits([2, 8], 28)).toEqual({ ok: true, value: 28 });
  });

  it('2桁 01→1', () => {
    expect(resolvePalletNoFromTenkeyDigits([0, 1], 10)).toEqual({ ok: true, value: 1 });
  });

  it('上限超え', () => {
    expect(resolvePalletNoFromTenkeyDigits([2, 9], 28).ok).toBe(false);
  });

  it('空', () => {
    expect(resolvePalletNoFromTenkeyDigits([], 10).ok).toBe(false);
  });
});
