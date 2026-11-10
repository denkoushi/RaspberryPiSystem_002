import { describe, expect, it } from 'vitest';
import { resolveRequiredMinutes } from '../grinding-planning-board-required-minutes.js';

const input = { originalMinutes: 100, originalKnown: true, quantity: 4, effectiveResourceCd: '305', fhincd: ' part ' };
const settings = { ownSourceResourceCds: ['305'], values: [{ resourceCd: '305', fhincd: 'part', perUnitMinutes: 10, setupMinutes: 30 }] };

describe('required minutes resolver', () => {
  it('uses the displayed resource and trimmed part, retaining both sources', () => {
    expect(resolveRequiredMinutes(input, settings)).toEqual({ requiredMinutes: 70, requiredMinutesKnown: true,
      originalRequiredMinutes: 100, ownRequiredMinutes: 70, requiredMinutesSource: 'own' });
  });
  it('computes own minutes even while original is selected', () => {
    expect(resolveRequiredMinutes(input, { ...settings, ownSourceResourceCds: [] }))
      .toMatchObject({ requiredMinutes: 100, ownRequiredMinutes: 70, requiredMinutesSource: 'original' });
  });
  it.each([null, 0, -1, NaN, Infinity])('falls back for unknown or invalid quantity %s', (quantity) => {
    expect(resolveRequiredMinutes({ ...input, quantity }, settings))
      .toMatchObject({ requiredMinutes: 100, ownRequiredMinutes: null, requiredMinutesSource: 'original' });
  });
  it('falls back on a missing part or different effective resource', () => {
    for (const patch of [{ fhincd: 'missing' }, { effectiveResourceCd: '306' }]) {
      expect(resolveRequiredMinutes({ ...input, ...patch }, settings)).toMatchObject({ requiredMinutes: 100, requiredMinutesSource: 'original' });
    }
  });
  it('uses own values with unknown CSV minutes and retains unknown fallback', () => {
    const unknown = { ...input, originalMinutes: null, originalKnown: false };
    expect(resolveRequiredMinutes(unknown, settings)).toMatchObject({ requiredMinutes: 70, requiredMinutesKnown: true, originalRequiredMinutes: null });
    expect(resolveRequiredMinutes({ ...unknown, quantity: null }, settings)).toMatchObject({ requiredMinutes: null, requiredMinutesKnown: false });
  });
  it('charges setup only on the first split piece and once after merging', () => {
    const pieces = [1, 3].map((quantity, index) => resolveRequiredMinutes({ ...input, quantity, includeSetup: index === 0 }, settings).requiredMinutes);
    expect(pieces).toEqual([40, 30]);
    expect(resolveRequiredMinutes(input, settings).requiredMinutes).toBe(70);
  });
  it('totals 360 minutes for ten units and preserves original when setup is excluded', () => {
    const unitSettings = { ownSourceResourceCds: ['305'], values: [{ ...settings.values[0]!, perUnitMinutes: 30, setupMinutes: 60 }] };
    const pieces = Array.from({ length: 10 }, (_, index) => resolveRequiredMinutes({ ...input, quantity: 1, includeSetup: index === 0 }, unitSettings));
    expect(pieces.map((piece) => piece.requiredMinutes)).toEqual([90, ...Array(9).fill(30)]);
    expect(pieces.reduce((sum, piece) => sum + piece.requiredMinutes!, 0)).toBe(360);
    expect(resolveRequiredMinutes({ ...input, includeSetup: false }, { ...unitSettings, ownSourceResourceCds: [] }))
      .toMatchObject({ requiredMinutes: 100, ownRequiredMinutes: 120, requiredMinutesSource: 'original' });
  });
  it('accepts zero own values', () => {
    expect(resolveRequiredMinutes(input, { ...settings, values: [{ ...settings.values[0]!, perUnitMinutes: 0, setupMinutes: 0 }] }))
      .toMatchObject({ requiredMinutes: 0, requiredMinutesKnown: true, requiredMinutesSource: 'own' });
  });
});
