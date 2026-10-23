import { describe, expect, it } from 'vitest';

import { parseStructuredShelfCode } from './mobile-placement-registered-shelves.service.js';

describe('parseStructuredShelfCode', () => {
  it.each(['DAD-3220', '50013_540AP', '加工機 A'])('parses machine %s before splitting hyphens', (machineName) => {
    expect(parseStructuredShelfCode(`  ${machineName}  北 `)).toEqual({
      isStructured: true, machineName, direction: '北'
    });
  });

  it.each(['', ' 北 ', 'DAD-3220北', 'DAD-3220 北東', 'garbage'])('rejects malformed code %s', (raw) => {
    expect(parseStructuredShelfCode(raw)).toEqual({ isStructured: false });
  });

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
