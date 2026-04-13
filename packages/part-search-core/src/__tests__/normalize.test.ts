import { describe, expect, it } from 'vitest';

import {
  normalizeMachineNameForPartSearch,
  normalizePartSearchQuery,
  partSearchTermVariantsForIlike
} from '../normalize.js';

describe('normalizePartSearchQuery', () => {
  it('unifies hiragana to katakana', () => {
    expect(normalizePartSearchQuery('てすと')).toBe('テスト');
    expect(normalizePartSearchQuery('テスト')).toBe('テスト');
  });

  it('maps sokuon to ツ for comparable match (does not delete)', () => {
    expect(normalizePartSearchQuery('がっこう')).toBe('ガツコウ');
    expect(normalizePartSearchQuery('がこう')).toBe('ガコウ');
    expect(normalizePartSearchQuery('がっこう')).not.toBe(normalizePartSearchQuery('がこう'));
  });

  it('maps ナット so it can substring-match ナットホルダー under comparable rules', () => {
    expect(normalizePartSearchQuery('ナット')).toBe('ナツト');
    const hay = normalizePartSearchQuery('ナットホルダー');
    expect(hay.includes(normalizePartSearchQuery('ナット'))).toBe(true);
  });

  it('maps small ya to ya', () => {
    expect(normalizePartSearchQuery('きゃく')).toBe('キャク');
  });

  it('does not absorb long vowel differences', () => {
    expect(normalizePartSearchQuery('モーター')).toBe('モーター');
    expect(normalizePartSearchQuery('モータ')).toBe('モータ');
    expect(normalizePartSearchQuery('モーター')).not.toBe(normalizePartSearchQuery('モータ'));
  });
});

describe('partSearchTermVariantsForIlike', () => {
  it('returns katakana and hiragana variants when different', () => {
    const v = partSearchTermVariantsForIlike('テスト');
    expect(v.sort()).toEqual(['テスト', 'てすと'].sort());
  });
});

describe('normalizeMachineNameForPartSearch', () => {
  it('applies kana unify then half-width upper', () => {
    expect(normalizeMachineNameForPartSearch('ｄａｄ３３５０')).toContain('DAD');
    expect(normalizeMachineNameForPartSearch('dad3350')).toBe('DAD3350');
  });
});
