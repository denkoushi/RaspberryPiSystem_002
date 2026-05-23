import { describe, expect, it } from 'vitest';

import { buildZoneOverviewCells } from '../model/zoneOverviewCells';

import type { DraftEntity } from '../model/shelfLayoutTypes';

describe('buildZoneOverviewCells', () => {
  it('maps each cell index to entity or null', () => {
    const entities: DraftEntity[] = [
      {
        entityKind: 'MACHINE',
        cellIndices: [0],
        resourceCd: 'RD01',
        resourceName: 'Robodrill01',
        shelfCodeRaw: null,
        displayLabel: null,
        aisleLabel: null
      },
      {
        entityKind: 'SHELF',
        cellIndices: [2],
        shelfCodeRaw: '中-中-01',
        displayLabel: 'RD01南',
        resourceCd: null,
        resourceName: null,
        aisleLabel: null
      }
    ];
    const cells = buildZoneOverviewCells(entities, 3);
    expect(cells).toHaveLength(9);
    expect(cells[0]?.entity?.entityKind).toBe('MACHINE');
    expect(cells[1]?.entity).toBeNull();
    expect(cells[2]?.entity?.entityKind).toBe('SHELF');
  });
});
