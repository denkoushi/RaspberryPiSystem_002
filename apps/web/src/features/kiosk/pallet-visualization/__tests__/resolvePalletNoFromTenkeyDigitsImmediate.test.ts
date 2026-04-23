import { describe, expect, it } from 'vitest';

import { resolvePalletNoFromTenkeyDigitsImmediate } from '../resolvePalletNoFromTenkeyDigitsImmediate';

describe('resolvePalletNoFromTenkeyDigitsImmediate', () => {
  it('returns null for empty buffer', () => {
    expect(resolvePalletNoFromTenkeyDigitsImmediate([], 10)).toBeNull();
  });

  it('resolves single digit 1-9 within max', () => {
    expect(resolvePalletNoFromTenkeyDigitsImmediate([3], 8)).toBe(3);
    expect(resolvePalletNoFromTenkeyDigitsImmediate([9], 9)).toBe(9);
    expect(resolvePalletNoFromTenkeyDigitsImmediate([9], 8)).toBeNull();
    expect(resolvePalletNoFromTenkeyDigitsImmediate([0], 10)).toBeNull();
  });

  it('resolves two digits when in range', () => {
    expect(resolvePalletNoFromTenkeyDigitsImmediate([1, 0], 12)).toBe(10);
    expect(resolvePalletNoFromTenkeyDigitsImmediate([1, 5], 15)).toBe(15);
    expect(resolvePalletNoFromTenkeyDigitsImmediate([1, 5], 12)).toBeNull();
  });

  it('uses first two digits when buffer is longer', () => {
    expect(resolvePalletNoFromTenkeyDigitsImmediate([1, 2, 3], 99)).toBe(12);
  });
});
