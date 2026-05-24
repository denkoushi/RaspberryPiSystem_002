import { describe, expect, it } from 'vitest';

import { releaseLayoutCells } from '../model/layoutCellRelease';

import type { DraftEntity } from '../model/shelfLayoutTypes';

describe('releaseLayoutCells', () => {
  it('returns unchanged when no cells selected', () => {
    const entities: DraftEntity[] = [
      {
        entityKind: 'MACHINE',
        cellIndices: [0],
        resourceCd: 'RD01',
        resourceName: 'Robodrill01',
        shelfCodeRaw: null,
        displayLabel: null,
        aisleLabel: null
      }
    ];
    expect(releaseLayoutCells(entities, [])).toBe(entities);
  });

  it('strips selected indices and drops empty entities', () => {
    const entities: DraftEntity[] = [
      {
        entityKind: 'MACHINE',
        cellIndices: [0, 1, 3],
        resourceCd: 'RD01',
        resourceName: 'Robodrill01',
        shelfCodeRaw: null,
        displayLabel: null,
        aisleLabel: null
      }
    ];
    const next = releaseLayoutCells(entities, [0, 1]);
    expect(next).toHaveLength(1);
    expect(next[0]?.cellIndices).toEqual([3]);
  });
});
