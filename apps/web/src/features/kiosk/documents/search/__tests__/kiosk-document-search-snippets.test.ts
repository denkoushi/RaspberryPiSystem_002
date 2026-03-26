import { describe, expect, it } from 'vitest';

import {
  buildKioskDocumentSearchSnippetModel,
  escapeRegExp,
} from '../kiosk-document-search-snippets';

describe('escapeRegExp', () => {
  it('escapes metacharacters', () => {
    expect(escapeRegExp('a+b')).toBe('a\\+b');
    expect(escapeRegExp('.*')).toBe('\\.\\*');
  });
});

describe('buildKioskDocumentSearchSnippetModel', () => {
  it('returns hidden when query is empty or whitespace', () => {
    expect(buildKioskDocumentSearchSnippetModel('hello', '')).toEqual({ mode: 'hidden' });
    expect(buildKioskDocumentSearchSnippetModel('hello', '   ')).toEqual({ mode: 'hidden' });
  });

  it('returns no_match when text is null or empty', () => {
    expect(buildKioskDocumentSearchSnippetModel(null, 'x')).toEqual({ mode: 'no_match' });
    expect(buildKioskDocumentSearchSnippetModel('', 'x')).toEqual({ mode: 'no_match' });
  });

  it('matches case-insensitively', () => {
    const r = buildKioskDocumentSearchSnippetModel('Hello WORLD', 'world');
    expect(r.mode).toBe('snippets');
    if (r.mode === 'snippets') {
      const hit = r.items[0].segments.find((s) => s.type === 'hit');
      expect(hit?.value).toBe('WORLD');
    }
  });

  it('finds literal dot when query contains dot', () => {
    const r = buildKioskDocumentSearchSnippetModel('ver. 2.0', '.');
    expect(r.mode).toBe('snippets');
    if (r.mode === 'snippets') {
      expect(r.items.length).toBeGreaterThan(0);
    }
  });

  it('returns no_match when nothing matches', () => {
    expect(buildKioskDocumentSearchSnippetModel('abc def', 'xyz')).toEqual({ mode: 'no_match' });
  });

  it('limits to maxSnippets', () => {
    const text = 'foo bar foo baz foo qux';
    const r = buildKioskDocumentSearchSnippetModel(text, 'foo', { maxSnippets: 2 });
    expect(r.mode).toBe('snippets');
    if (r.mode === 'snippets') {
      expect(r.items).toHaveLength(2);
    }
  });

  it('includes context and ellipsis when clipped', () => {
    const prefix = 'a'.repeat(80);
    const text = `${prefix}TARGET${prefix}`;
    const r = buildKioskDocumentSearchSnippetModel(text, 'TARGET', { contextLength: 10 });
    expect(r.mode).toBe('snippets');
    if (r.mode === 'snippets') {
      const joined = r.items[0].segments.map((s) => s.value).join('');
      expect(joined).toContain('…');
      expect(joined).toContain('TARGET');
    }
  });
});
