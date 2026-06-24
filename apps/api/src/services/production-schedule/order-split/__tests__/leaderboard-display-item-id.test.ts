import { describe, expect, it } from 'vitest';

import {
  buildRowDisplayItemId,
  buildSplitDisplayItemId,
  collectSplitIdsFromDisplayItemIds,
  parseDisplayItemId,
  resolveUniqueSourceRowIdsFromDisplayItemIds
} from '../leaderboard-display-item-id.js';

describe('leaderboard-display-item-id', () => {
  const parentId = '11111111-1111-4111-8111-111111111111';
  const splitId = '22222222-2222-4222-8222-222222222222';

  it('parses row UUID as row kind', () => {
    const parsed = parseDisplayItemId(parentId);
    expect(parsed).toEqual({
      kind: 'row',
      displayItemId: parentId,
      sourceRowId: parentId
    });
  });

  it('parses split display item id', () => {
    const displayId = buildSplitDisplayItemId(splitId);
    const parsed = parseDisplayItemId(displayId);
    expect(parsed?.kind).toBe('split');
    if (parsed?.kind === 'split') {
      expect(parsed.splitId).toBe(splitId);
    }
  });

  it('builds stable display item ids', () => {
    expect(buildRowDisplayItemId(parentId)).toBe(parentId);
    expect(buildSplitDisplayItemId(splitId)).toBe(`split:${splitId}`);
  });

  it('collects split ids from mixed display item ids', () => {
    expect(
      collectSplitIdsFromDisplayItemIds([parentId, buildSplitDisplayItemId(splitId), buildSplitDisplayItemId(splitId)])
    ).toEqual([splitId]);
  });

  it('resolves unique source row ids from unsplit display ids', () => {
    expect(resolveUniqueSourceRowIdsFromDisplayItemIds([parentId, parentId])).toEqual([parentId]);
  });
});
