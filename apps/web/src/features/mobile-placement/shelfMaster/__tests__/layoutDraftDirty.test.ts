import { describe, expect, it } from 'vitest';

import { isLayoutDraftDirty, snapshotFromZone } from '../model/layoutDraftDirty';

describe('isLayoutDraftDirty', () => {
  it('returns false when unchanged', () => {
    const snap = snapshotFromZone(3, [
      {
        entityKind: 'SHELF',
        cellIndices: [4],
        resourceCd: null,
        resourceName: null,
        shelfCodeRaw: '中央-中央-01',
        displayLabel: 'A',
        aisleLabel: null
      }
    ]);
    expect(isLayoutDraftDirty(snap, snap)).toBe(false);
  });

  it('returns true when grid size changes', () => {
    const base = snapshotFromZone(3, []);
    const current = snapshotFromZone(4, []);
    expect(isLayoutDraftDirty(base, current)).toBe(true);
  });
});
