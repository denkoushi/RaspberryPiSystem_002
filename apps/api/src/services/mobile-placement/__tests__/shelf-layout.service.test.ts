import { describe, expect, it } from 'vitest';

import { parseStructuredShelfCode } from '../mobile-placement-registered-shelves.service.js';
import { validateLayoutEntities } from '../shelf-layout-edit.service.js';

describe('parseStructuredShelfCode tier', () => {
  it('parses 4-segment shelf code with tier', () => {
    expect(parseStructuredShelfCode('西-北-02-1')).toEqual({
      isStructured: true,
      areaId: 'west',
      lineId: 'north',
      slot: 2,
      tier: 1
    });
  });
});

describe('validateLayoutEntities', () => {
  it('rejects overlapping cells', () => {
    expect(() =>
      validateLayoutEntities(
        [
          { entityKind: 'SHELF', cellIndices: [0] },
          { entityKind: 'AISLE', cellIndices: [0] }
        ],
        3
      )
    ).toThrow();
  });
});
