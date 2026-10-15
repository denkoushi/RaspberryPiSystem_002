import { describe, expect, it } from 'vitest';
import { FSEIBAN_CONFUSABLE_GROUPS, fseibanOcrDistance, normalizeFseibanToken, snapFseiban } from '../genpyo-slip/fseiban-snap.js';

const known = ['AA1P2M12', 'BE1N9321', 'BE1NA310', 'AA1NBM14', 'BE1N9327'];
describe('FSEIBAN snap', () => {
  it('normalizes full width, case and separators', () => {
    expect(normalizeFseibanToken(' ｂｅ１－ｎ_９３２１ ')).toBe('BE1N9321');
  });
  it('uses symmetric substitutions and unit insertion/deletion costs', () => {
    for (const group of FSEIBAN_CONFUSABLE_GROUPS) {
      for (const a of group) for (const b of group) expect(fseibanOcrDistance(a, b)).toBe(a === b ? 0 : 0.3);
    }
    expect(fseibanOcrDistance('AB', 'ABC')).toBe(1);
    expect(fseibanOcrDistance('ABC', 'AB')).toBe(1);
    expect(fseibanOcrDistance('X', 'R')).toBe(1);
  });
  it.each([
    ['8E1N9321', 'BE1N9321'], ['AA1P2MI2', 'AA1P2M12'], ['BEINA31O', 'BE1NA310']
  ])('corrects %s to %s', (token, expected) => {
    expect(snapFseiban([token], known)).toMatchObject({ match: 'corrected', fseiban: expected });
  });
  it('never auto-corrects a different digit into a neighbouring 製番', () => {
    // BE1N9327 is a real but different 製番: 7 and 1 are not treated as confusable.
    expect(snapFseiban(['BE1N9327'], known.filter((v) => v !== 'BE1N9327')).match).toBe('ambiguous');
    expect(fseibanOcrDistance('7', '1')).toBe(1);
  });
  it('returns tied candidates and no selected value', () => {
    expect(snapFseiban(['AA1O0M12'], ['AA100M12', 'AA1OOM12'])).toEqual({
      match: 'ambiguous', fseiban: null, candidates: ['AA100M12', 'AA1OOM12']
    });
  });
  it('handles threshold boundaries and caps candidates', () => {
    expect(snapFseiban(['OOXXXXXX'], ['00XXXXXX']).match).toBe('corrected');
    expect(snapFseiban(['OOOXXXXX'], ['000XXXXX']).match).toBe('ambiguous');
    expect(snapFseiban(['XXXXXXXX'], ['YXXXXXXX']).match).toBe('ambiguous');
    expect(snapFseiban(['XXXXXXXX'], ['YYXXXXXX']).match).toBe('ambiguous');
    expect(snapFseiban(['XXXXXXXX'], ['YYYXXXXX']).match).toBe('none');
    expect(snapFseiban(['BE1N932I'], [...known, 'BE1N932L', 'BE1N932T']).candidates).toHaveLength(3);
  });
  it('returns none for garbage, empty tokens and length-filtered values', () => {
    for (const tokens of [['XXXXXXXX'], [], [''], ['BE1']]) {
      expect(snapFseiban(tokens, known)).toEqual({ match: 'none', fseiban: null, candidates: [] });
    }
  });
});
