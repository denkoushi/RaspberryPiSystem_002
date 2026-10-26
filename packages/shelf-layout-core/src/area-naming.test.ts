import { describe, expect, it } from 'vitest';

import { AREA_DIRECTIONS, SHELF_DIRECTIONS, composeArea, splitArea } from './area-naming.js';

describe('area naming', () => {
  it('keeps inventory choices at four cardinal directions', () => {
    expect(AREA_DIRECTIONS).toEqual(['東', '西', '南', '北']);
  });
  it.each(SHELF_DIRECTIONS)('roundtrips %s including diagonal suffixes', (direction) => {
    expect(splitArea(composeArea('  加工機 A  ', direction))).toEqual({ machine: '加工機 A', direction });
    expect(splitArea(`電気室   ${direction}`)).toEqual({ machine: '電気室', direction });
  });
  it.each(['電気室', '加工機南東', '西-北-02', '北'])('keeps %s without a direction', (name) => {
    expect(splitArea(name)).toEqual({ machine: name, direction: null });
  });
});
