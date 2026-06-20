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
  const parentA = '11111111-1111-4111-8111-111111111111';
  const parentB = '22222222-2222-4222-8222-222222222222';

  it('uses preferredDisplayRowIds when provided (normalized)', () => {
    expect(
      resolveLeaderboardFooterPreferredRowIds({
        rows: [{ id: parentA }],
        preferredDisplayRowIds: [`  ${parentA} `, ` ${parentB} `, ` ${parentA}`]
      })
    ).toEqual([parentA, parentB]);
  });

  it('maps split display item ids to parent row ids for SQL winner preference', () => {
    const parentId = '11111111-1111-4111-8111-111111111111';
    const splitId = '22222222-2222-4222-8222-222222222222';
    expect(
      resolveLeaderboardFooterPreferredRowIds({
        rows: [{ id: `split:${splitId}`, sourceRowId: parentId }],
        preferredDisplayRowIds: [`split:${splitId}`]
      })
    ).toEqual([parentId]);
  });

  it('falls back to parent row ids derived from rows when preferred omitted', () => {
    const parentId = '11111111-1111-4111-8111-111111111111';
    expect(
      resolveLeaderboardFooterPreferredRowIds({
        rows: [{ id: `split:22222222-2222-4222-8222-222222222222`, sourceRowId: parentId }]
      })
    ).toEqual([parentId]);
    expect(
      resolveLeaderboardFooterPreferredRowIds({
        rows: [{ id: `  ${parentId} ` }, { id: '' }, { id: parentId }]
      })
    ).toEqual([parentId]);
  });
});
