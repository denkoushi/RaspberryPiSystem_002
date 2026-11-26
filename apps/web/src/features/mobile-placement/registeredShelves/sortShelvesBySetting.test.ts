import { describe, expect, it } from 'vitest';

import { sortShelvesBySetting } from './sortShelvesBySetting';

import type { RegisteredShelfEntryDto } from './types';

const shelf = (shelfCodeRaw: string, machineName?: string, sortOrder?: number | null): RegisteredShelfEntryDto =>
  ({ shelfCodeRaw, isStructured: true, machineName, sortOrder });
const codes = (shelves: RegisteredShelfEntryDto[]) => shelves.map((s) => s.shelfCodeRaw);

describe('sortShelvesBySetting', () => {
  it('keeps the original order when nothing is set', () => {
    const shelves = [shelf('A 北', 'A'), shelf('B 北', 'B'), shelf('A 南', 'A'), shelf('x')];
    expect(codes(sortShelvesBySetting(shelves))).toEqual(['A 北', 'A 南', 'B 北', 'x']);
  });

  it('orders machines by their smallest order and shelves inside a machine by their own order', () => {
    const shelves = [shelf('A 北', 'A', 3), shelf('B 北', 'B', 0), shelf('A 南', 'A', 2), shelf('B 南', 'B', 1), shelf('C 北', 'C')];
    expect(codes(sortShelvesBySetting(shelves))).toEqual(['B 北', 'B 南', 'A 南', 'A 北', 'C 北']);
  });

  it('puts unset shelves after the set ones in a machine and unset machines last, in the original order', () => {
    const shelves = [shelf('Z 北', 'Z'), shelf('A 北', 'A'), shelf('A 南', 'A', 5), shelf('其', undefined, 4), shelf('他')];
    expect(codes(sortShelvesBySetting(shelves))).toEqual(['其', '他', 'A 南', 'A 北', 'Z 北']);
  });
});
