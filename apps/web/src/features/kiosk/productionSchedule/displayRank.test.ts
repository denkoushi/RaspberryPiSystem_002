import { describe, expect, it } from 'vitest';

import { buildResourceLocalRankMap } from './displayRank';

describe('buildResourceLocalRankMap', () => {
  it('globalRank順で 1..N の表示順位を採番する', () => {
    const map = buildResourceLocalRankMap([
      { id: 'row-3', globalRank: 3, fseiban: 'C', productNo: '30', fkojun: '30' },
      { id: 'row-1', globalRank: 1, fseiban: 'A', productNo: '10', fkojun: '10' },
      { id: 'row-2', globalRank: 2, fseiban: 'B', productNo: '20', fkojun: '20' }
    ]);

    expect(map.get('row-1')).toBe(1);
    expect(map.get('row-2')).toBe(2);
    expect(map.get('row-3')).toBe(3);
  });

  it('globalRank が null の行は採番しない', () => {
    const map = buildResourceLocalRankMap([
      { id: 'ranked', globalRank: 1, fseiban: 'A', productNo: '10', fkojun: '10' },
      { id: 'unranked', globalRank: null, fseiban: 'B', productNo: '20', fkojun: '20' }
    ]);

    expect(map.get('ranked')).toBe(1);
    expect(map.has('unranked')).toBe(false);
  });

  it('同じ globalRank の場合は FSEIBAN -> ProductNo -> FKOJUN で安定化する', () => {
    const map = buildResourceLocalRankMap([
      { id: 'row-c', globalRank: 1, fseiban: 'B', productNo: '2', fkojun: '20' },
      { id: 'row-a', globalRank: 1, fseiban: 'A', productNo: '10', fkojun: '30' },
      { id: 'row-b', globalRank: 1, fseiban: 'A', productNo: '11', fkojun: '10' }
    ]);

    expect(map.get('row-a')).toBe(1);
    expect(map.get('row-b')).toBe(2);
    expect(map.get('row-c')).toBe(3);
  });
});
