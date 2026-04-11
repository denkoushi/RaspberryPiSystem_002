import { describe, expect, it } from 'vitest';

import { filterStructuredShelvesByAreaLine, listUnstructuredShelves } from './filterRegisteredShelves';

import type { RegisteredShelfEntryDto } from './types';

describe('filterRegisteredShelves', () => {
  const sample: RegisteredShelfEntryDto[] = [
    { shelfCodeRaw: 'TEMP-A', isStructured: false },
    {
      shelfCodeRaw: '西-北-01',
      isStructured: true,
      areaId: 'west',
      lineId: 'north',
      slot: 1
    },
    {
      shelfCodeRaw: '西-北-02',
      isStructured: true,
      areaId: 'west',
      lineId: 'north',
      slot: 2
    },
    {
      shelfCodeRaw: '東-南-03',
      isStructured: true,
      areaId: 'east',
      lineId: 'south',
      slot: 3
    }
  ];

  it('filters structured shelves by west/north', () => {
    const r = filterStructuredShelvesByAreaLine(sample, 'west', 'north');
    expect(r.map((x) => x.shelfCodeRaw)).toEqual(['西-北-01', '西-北-02']);
  });

  it('lists unstructured only', () => {
    expect(listUnstructuredShelves(sample).map((x) => x.shelfCodeRaw)).toEqual(['TEMP-A']);
  });
});
