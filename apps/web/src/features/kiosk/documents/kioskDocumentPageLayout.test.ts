import { describe, expect, it } from 'vitest';

import { buildPagePairs } from './kioskDocumentPageLayout';

describe('buildPagePairs', () => {
  it('single: one URL per row', () => {
    const urls = ['/a', '/b', '/c'];
    expect(buildPagePairs(urls, 'single')).toEqual([['/a'], ['/b'], ['/c']]);
  });

  it('spread: pairs of two', () => {
    const urls = ['/1', '/2', '/3', '/4', '/5'];
    expect(buildPagePairs(urls, 'spread')).toEqual([['/1', '/2'], ['/3', '/4'], ['/5']]);
  });

  it('empty: returns empty', () => {
    expect(buildPagePairs([], 'single')).toEqual([]);
    expect(buildPagePairs([], 'spread')).toEqual([]);
  });
});
