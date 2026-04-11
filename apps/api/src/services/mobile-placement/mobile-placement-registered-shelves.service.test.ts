import { describe, expect, it } from 'vitest';

import { parseStructuredShelfCode } from './mobile-placement-registered-shelves.service.js';

describe('parseStructuredShelfCode', () => {
  it('parses west-north slot', () => {
    expect(parseStructuredShelfCode('西-北-01')).toEqual({
      isStructured: true,
      areaId: 'west',
      lineId: 'north',
      slot: 1
    });
  });

  it('returns unstructured for TEMP-A', () => {
    expect(parseStructuredShelfCode('TEMP-A')).toEqual({ isStructured: false });
  });

  it('returns unstructured for wrong segment count', () => {
    expect(parseStructuredShelfCode('西-北')).toEqual({ isStructured: false });
  });
});
