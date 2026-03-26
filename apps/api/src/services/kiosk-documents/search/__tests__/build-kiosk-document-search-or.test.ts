import { describe, expect, it } from 'vitest';

import {
  buildKioskDocumentSearchOrConditions,
  escapeLikePattern,
} from '../build-kiosk-document-search-or.js';

describe('escapeLikePattern', () => {
  it('removes percent signs to avoid ILIKE wildcard', () => {
    expect(escapeLikePattern('a%b')).toBe('ab');
    expect(escapeLikePattern('100%')).toBe('100');
  });

  it('returns empty when only percent', () => {
    expect(escapeLikePattern('%')).toBe('');
    expect(escapeLikePattern('%%')).toBe('');
  });

  it('preserves underscore (single-char wildcard risk documented; part numbers may use _)', () => {
    expect(escapeLikePattern('M_100')).toBe('M_100');
  });
});

describe('buildKioskDocumentSearchOrConditions', () => {
  it('returns 9 OR branches without candidates', () => {
    const or = buildKioskDocumentSearchOrConditions('test', { includeCandidateFields: false });
    expect(or).toHaveLength(9);
    expect(or.some((c) => 'candidateFhincd' in c)).toBe(false);
  });

  it('returns 13 OR branches with candidates', () => {
    const or = buildKioskDocumentSearchOrConditions('x', { includeCandidateFields: true });
    expect(or).toHaveLength(13);
    expect(or.some((c) => 'candidateFhincd' in c)).toBe(true);
    expect(or.some((c) => 'extractedText' in c)).toBe(true);
  });

  it('embeds the same query string in each branch', () => {
    const or = buildKioskDocumentSearchOrConditions('名古屋', { includeCandidateFields: false });
    for (const clause of or) {
      const leaf = Object.values(clause)[0] as { contains: string };
      expect(leaf.contains).toBe('名古屋');
    }
  });
});
