import { describe, expect, it } from 'vitest';

import {
  resolveSeibanAccentHexForSignage,
  seibanAccentPaletteIndexForString,
} from './leader-order-seiban-accent-palette.js';

describe('leader-order-seiban-accent-palette', () => {
  it('seibanAccentPaletteIndexForString is stable for same input', () => {
    expect(seibanAccentPaletteIndexForString('BA1S1319')).toBe(seibanAccentPaletteIndexForString('BA1S1319'));
  });

  it('resolveSeibanAccentHexForSignage returns hex for non-empty fseiban', () => {
    const hex = resolveSeibanAccentHexForSignage('BA1S1319');
    expect(hex).toMatch(/^#[0-9a-f]{6}$/i);
  });

  it('resolveSeibanAccentHexForSignage returns undefined for blank', () => {
    expect(resolveSeibanAccentHexForSignage('')).toBeUndefined();
    expect(resolveSeibanAccentHexForSignage('   ')).toBeUndefined();
  });
});
