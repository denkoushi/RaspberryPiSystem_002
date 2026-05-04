import { describe, expect, it } from 'vitest';

import { mergeSharedHistoryWithLocalOrder } from '../mergeSharedHistoryWithLocalOrder';
import { reorderSeibanInMergedList } from '../reorderSeibanInMergedList';

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
