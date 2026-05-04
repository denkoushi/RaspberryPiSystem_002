import { describe, expect, it } from 'vitest';

import { mergeSharedHistoryWithLocalOrder } from '../mergeSharedHistoryWithLocalOrder';
import { reorderSeibanInMergedList } from '../reorderSeibanInMergedList';
import { reorderSeibanToRank } from '../reorderSeibanToRank';

describe('mergeSharedHistoryWithLocalOrder', () => {
  it('keeps local order for shared items then appends the rest in shared order', () => {
    const shared = ['A', 'B', 'C'];
    const local = ['C', 'A'];
    expect(mergeSharedHistoryWithLocalOrder(shared, local)).toEqual(['C', 'A', 'B']);
  });

  it('drops local entries not in shared', () => {
    expect(mergeSharedHistoryWithLocalOrder(['A'], ['Z', 'A'])).toEqual(['A']);
  });

  it('appends unknown shared items after local segment', () => {
    expect(mergeSharedHistoryWithLocalOrder(['D', 'A'], ['A'])).toEqual(['A', 'D']);
  });
});

describe('reorderSeibanInMergedList', () => {
  it('swaps with neighbor upward', () => {
    expect(reorderSeibanInMergedList(['A', 'B', 'C'], 'B', 'up')).toEqual(['B', 'A', 'C']);
  });

  it('no-op at top when moving up', () => {
    expect(reorderSeibanInMergedList(['A', 'B'], 'A', 'up')).toEqual(['A', 'B']);
  });
});

describe('reorderSeibanToRank', () => {
  it('moves item to first rank', () => {
    expect(reorderSeibanToRank(['A', 'B', 'C'], 'C', 1)).toEqual(['C', 'A', 'B']);
  });

  it('moves item to last rank', () => {
    expect(reorderSeibanToRank(['A', 'B', 'C'], 'A', 3)).toEqual(['B', 'C', 'A']);
  });

  it('moves middle item to end', () => {
    expect(reorderSeibanToRank(['A', 'B', 'C', 'D'], 'B', 4)).toEqual(['A', 'C', 'D', 'B']);
  });

  it('no-op when rank unchanged', () => {
    expect(reorderSeibanToRank(['A', 'B', 'C'], 'B', 2)).toEqual(['A', 'B', 'C']);
  });

  it('no-op when fseiban missing', () => {
    expect(reorderSeibanToRank(['A', 'B'], 'Z', 1)).toEqual(['A', 'B']);
  });

  it('no-op when fseiban blank', () => {
    expect(reorderSeibanToRank(['A', 'B'], '   ', 1)).toEqual(['A', 'B']);
  });

  it('clamps rank below 1 to first', () => {
    expect(reorderSeibanToRank(['A', 'B', 'C'], 'C', 0)).toEqual(['C', 'A', 'B']);
  });

  it('clamps rank above n to last', () => {
    expect(reorderSeibanToRank(['A', 'B', 'C'], 'A', 99)).toEqual(['B', 'C', 'A']);
  });

  it('matches trim on list entries', () => {
    expect(reorderSeibanToRank([' A ', 'B'], 'A', 2)).toEqual(['B', ' A ']);
  });
});
