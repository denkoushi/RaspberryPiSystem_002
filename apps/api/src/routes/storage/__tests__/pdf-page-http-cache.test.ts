import { describe, expect, it } from 'vitest';

import {
  buildPdfPageEtag,
  DEFAULT_PDF_PAGE_CACHE_CONTROL,
  ifNoneMatchSatisfied,
  resolvePdfPageCacheControl,
} from '../pdf-page-http-cache.js';

describe('buildPdfPageEtag', () => {
  it('returns quoted etag from size and mtimeMs', () => {
    expect(buildPdfPageEtag({ size: 1024, mtimeMs: 1_700_000_000_000 })).toBe('"1024-1700000000000"');
  });
});

describe('ifNoneMatchSatisfied', () => {
  const etag = '"100-200"';

  it('returns false when header missing', () => {
    expect(ifNoneMatchSatisfied(undefined, etag)).toBe(false);
  });

  it('returns true on exact match', () => {
    expect(ifNoneMatchSatisfied(etag, etag)).toBe(true);
  });

  it('returns true when one of comma-separated values matches', () => {
    expect(ifNoneMatchSatisfied(`"other", ${etag}`, etag)).toBe(true);
  });

  it('returns true for weak validator with same opaque', () => {
    expect(ifNoneMatchSatisfied('W/"100-200"', etag)).toBe(true);
  });

  it('returns true for *', () => {
    expect(ifNoneMatchSatisfied('*', etag)).toBe(true);
  });

  it('supports header array values', () => {
    expect(ifNoneMatchSatisfied(['"other"', etag], etag)).toBe(true);
  });
});

describe('resolvePdfPageCacheControl', () => {
  it('returns default when env unset', () => {
    const prev = process.env.PDF_PAGES_CACHE_CONTROL;
    delete process.env.PDF_PAGES_CACHE_CONTROL;
    try {
      expect(resolvePdfPageCacheControl()).toBe(DEFAULT_PDF_PAGE_CACHE_CONTROL);
    } finally {
      if (prev !== undefined) process.env.PDF_PAGES_CACHE_CONTROL = prev;
      else delete process.env.PDF_PAGES_CACHE_CONTROL;
    }
  });
});
