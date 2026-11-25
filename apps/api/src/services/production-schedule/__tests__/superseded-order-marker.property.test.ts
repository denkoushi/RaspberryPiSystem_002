import * as fc from 'fast-check';
import { expect, it } from 'vitest';

import { computeSupersededRowIds, statusByKeyFromDedupedMailRows } from '../superseded-order-marker.js';

it('marks an order without an exact match only when every available status for that process is X', () => {
  const scheduleKey = { fseiban: 'S', fhincd: 'H', fsigencd: 'MSZ', fkojun: '10' };
  const rows = [
    { ...scheduleKey, id: 'old', productNo: '1' },
    { ...scheduleKey, id: 'new', productNo: '2' },
  ];

  fc.assert(fc.property(fc.array(fc.constantFrom('X', 'X', 'X', 'P', 'C', '?', ''), { maxLength: 8 }), (codes) => {
    const statuses = codes.map((statusCode, index) => ({
      fkojun: '10', fkoteicd: String(568 + index), fsezono: '1', statusCode,
    }));
    const shouldMark = codes.length > 0 && codes.every((code) => code === 'X');
    expect(computeSupersededRowIds(rows, statusByKeyFromDedupedMailRows(statuses)))
      .toEqual(new Set(shouldMark ? ['old'] : []));
  }));
});
