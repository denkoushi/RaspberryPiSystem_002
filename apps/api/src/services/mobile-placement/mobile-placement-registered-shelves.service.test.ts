import { describe, expect, it } from 'vitest';

import { parseStructuredShelfCode } from './mobile-placement-registered-shelves.service.js';

describe('parseStructuredShelfCode', () => {
  it.each(['DAD-3220', '50013_540AP', '加工機 A'])('parses machine %s before splitting hyphens', (machineName) => {
    expect(parseStructuredShelfCode(`  ${machineName}  北 `)).toEqual({
      isStructured: true, machineName, direction: '北'
    });
  });

  it.each(['', ' 北 ', 'DAD-3220北', 'garbage'])('rejects malformed code %s', (raw) => {
    expect(parseStructuredShelfCode(raw)).toEqual({ isStructured: false });
  });

  it.each(['北西', '北東', '南西', '南東'])('parses %s without consuming its first character as a name', (direction) => {
    expect(parseStructuredShelfCode(`電気室 ${direction}`)).toEqual({ isStructured: true, machineName: '電気室', direction });
  });

  it('recognizes directionless names only with a known-name match, including names ending in a direction', () => {
    for (const name of ['電気室', '加工機 A', '電気室 南東']) {
      expect(parseStructuredShelfCode(name, new Set([name]))).toEqual({ isStructured: true, machineName: name });
    }
    expect(parseStructuredShelfCode('電気室')).toEqual({ isStructured: false });
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
