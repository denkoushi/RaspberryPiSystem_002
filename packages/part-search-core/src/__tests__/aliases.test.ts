import { describe, expect, it } from 'vitest';

import { expandSearchTerms } from '../aliases.js';

describe('expandSearchTerms', () => {
  it('empty query returns empty terms', () => {
    expect(expandSearchTerms('')).toEqual({ terms: [], aliasMatchedBy: null });
  });

  it('expands アシ group with synonyms', () => {
    const r = expandSearchTerms('アシ');
    expect(r.aliasMatchedBy).toBe('アシ/脚/足');
    expect(r.terms.sort()).toEqual(['アシ', '脚', '足'].sort());
  });

  it('matches 脚 substring and expands group', () => {
    const r = expandSearchTerms('テーブル脚');
    expect(r.aliasMatchedBy).toBe('アシ/脚/足');
    expect(r.terms).toContain('テフル脚');
    expect(r.terms).toContain('テフルアシ');
    expect(r.terms).toContain('テフル足');
  });

  it('unrelated query stays single term', () => {
    const r = expandSearchTerms('ボルト');
    expect(r.aliasMatchedBy).toBeNull();
    expect(r.terms).toEqual(['ホルト']);
  });
});
