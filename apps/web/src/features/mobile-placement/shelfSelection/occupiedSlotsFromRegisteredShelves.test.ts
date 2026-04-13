import { describe, expect, it } from 'vitest';

import { getOccupiedSlotsForRegisteredShelves } from './occupiedSlotsFromRegisteredShelves';

import type { RegisteredShelfEntryDto } from '../registeredShelves/types';

describe('getOccupiedSlotsForRegisteredShelves', () => {
  it('collects slots for matching area and line', () => {
    const shelves: RegisteredShelfEntryDto[] = [
      {
        shelfCodeRaw: '西-北-01',
        isStructured: true,
        areaId: 'west',
        lineId: 'north',
        slot: 1
      },
      {
        shelfCodeRaw: '西-北-03',
        isStructured: true,
        areaId: 'west',
        lineId: 'north',
        slot: 3
      },
      {
        shelfCodeRaw: '東-南-02',
        isStructured: true,
        areaId: 'east',
        lineId: 'south',
        slot: 2
      }
    ];
    const set = getOccupiedSlotsForRegisteredShelves(shelves, 'west', 'north');
    expect([...set].sort((a, b) => a - b)).toEqual([1, 3]);
  });
});
