import { describe, expect, it } from 'vitest';

import { collectDisplayItemPrefixGapQueries } from '../leaderboard-shell-display-item-prefix.service.js';

describe('collectDisplayItemPrefixGapQueries', () => {
  it('detects missing parents up to first-page max order and between first page and beyond', () => {
    const queries = collectDisplayItemPrefixGapQueries({
      pageSize: 1,
      expandedDisplayItems: [{ processingOrder: 10 }, { processingOrder: 30 }]
    });

    expect(queries).toEqual([
      { kind: 'atMost', maxOrderInclusive: 10 },
      { kind: 'between', minOrderExclusive: 10, maxOrderExclusive: 30 }
    ]);
  });

  it('detects missing parents up to first-page max when beyond-page items share the page', () => {
    const queries = collectDisplayItemPrefixGapQueries({
      pageSize: 2,
      expandedDisplayItems: [{ processingOrder: 10 }, { processingOrder: 30 }]
    });

    expect(queries).toEqual([{ kind: 'atMost', maxOrderInclusive: 30 }]);
  });

  it('detects a gap before later split items once first page ends before them', () => {
    const queries = collectDisplayItemPrefixGapQueries({
      pageSize: 2,
      expandedDisplayItems: [
        { processingOrder: 10 },
        { processingOrder: 20 },
        { processingOrder: 30 }
      ]
    });

    expect(queries).toEqual([
      { kind: 'atMost', maxOrderInclusive: 20 },
      { kind: 'between', minOrderExclusive: 20, maxOrderExclusive: 30 }
    ]);
  });
});
