import { describe, expect, it } from 'vitest';

import {
  collectLeaderboardFooterPartKeysFromRows,
  resolveLeaderboardFooterPreferredRowIds
} from '../leaderboard-footer-part-key-collector.js';

describe('collectLeaderboardFooterPartKeysFromRows', () => {
  it('keeps first-seen part keys and skips incomplete triples', () => {
    const { uniquePartKeysInOrder, tripleByPartKey } = collectLeaderboardFooterPartKeysFromRows([
      {
        seibanJoinKey: 'S1',
        rowData: { ProductNo: 'P1', FHINCD: 'H1' }
      },
      {
        seibanJoinKey: 'S1',
        rowData: { ProductNo: 'P1', FHINCD: 'H1' }
      },
      {
        seibanJoinKey: '',
        rowData: { ProductNo: 'PX', FHINCD: 'HX' }
      }
    ]);
    expect(uniquePartKeysInOrder).toHaveLength(1);
    expect(tripleByPartKey.get(uniquePartKeysInOrder[0]!)).toEqual({
      seibanJoinKey: 'S1',
      productNo: 'P1',
      fhincd: 'H1'
    });
  });
});

describe('resolveLeaderboardFooterPreferredRowIds', () => {
  it('uses preferredDisplayRowIds when provided (normalized)', () => {
    expect(
      resolveLeaderboardFooterPreferredRowIds({
        rows: [{ id: 'x' }],
        preferredDisplayRowIds: ['  a ', ' b ', ' a']
      })
    ).toEqual(['a', 'b']);
  });

  it('falls back to row ids when preferred omitted', () => {
    expect(
      resolveLeaderboardFooterPreferredRowIds({
        rows: [{ id: '  z ' }, { id: '' }, { id: 'z' }]
      })
    ).toEqual(['z']);
  });
});
