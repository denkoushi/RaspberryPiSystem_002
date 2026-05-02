import { describe, expect, it } from 'vitest';

import {
  resolveSeibanAccentRowClass,
  seibanAccentPaletteIndexForString
} from '../seibanAccentPalette';

describe('resolveSeibanAccentRowClass', () => {
  it('returns stable hash-based class when filters empty', () => {
    const a = resolveSeibanAccentRowClass('S001', []);
    expect(a).toBeTruthy();
    expect(resolveSeibanAccentRowClass('S001', [])).toBe(a);
  });

  it('returns undefined when fseiban is blank after trim', () => {
    expect(resolveSeibanAccentRowClass('   ', [])).toBeUndefined();
  });

  it('returns stable class for matching filter entry', () => {
    const a = resolveSeibanAccentRowClass('S-A', ['S-A', 'S-B']);
    const b = resolveSeibanAccentRowClass('S-A', ['S-A', 'S-B']);
    expect(a).toBeTruthy();
    expect(a).toBe(b);
    expect(resolveSeibanAccentRowClass('S-B', ['S-A', 'S-B'])).not.toBe(a);
  });

  it('dedupes and trims filter list', () => {
    expect(
      resolveSeibanAccentRowClass(' X ', [' X ', '  X  ', 'Y'])
    ).toBe(resolveSeibanAccentRowClass('X', ['X', 'Y']));
  });
});

describe('seibanAccentPaletteIndexForString', () => {
  it('stable for same input', () => {
    expect(seibanAccentPaletteIndexForString('abc')).toBe(seibanAccentPaletteIndexForString('abc'));
  });
});
