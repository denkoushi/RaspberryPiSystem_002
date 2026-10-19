import { describe, expect, it } from 'vitest';

import { FSEIBAN_LIST_LIMIT, normalizeFseibanList } from '../fseiban-list.js';

describe('normalizeFseibanList', () => {
  it('handles empty lists', () => {
    expect(normalizeFseibanList([])).toEqual([]);
  });

  it('trims whitespace, skips empty values and keeps first occurrence order', () => {
    const items = [' B ', '', ' A', 'B', ' \t\n', 'A ', ' C ', 'b'] as const;
    expect(normalizeFseibanList(items)).toEqual(['B', 'A', 'C', 'b']);
    expect(items[0]).toBe(' B ');
  });

  it('limits 2500 distinct values to the first 2000 by default', () => {
    const items = Array.from({ length: 2500 }, (_, i) => String(i));
    expect(FSEIBAN_LIST_LIMIT).toBe(2000);
    expect(normalizeFseibanList(items)).toEqual(items.slice(0, 2000));
  });

  it('counts only distinct nonempty values toward a custom limit', () => {
    expect(normalizeFseibanList(['', ' A ', 'A', ' B ', 'C'], 2)).toEqual(['A', 'B']);
    expect(normalizeFseibanList(['A'], 0)).toEqual([]);
  });

  it('stops reading items as soon as the limit is reached', () => {
    const items = ['A', 'B', 'C'];
    Object.defineProperty(items, 2, { get: () => { throw new Error('read beyond limit'); } });
    expect(normalizeFseibanList(items, 2)).toEqual(['A', 'B']);
  });

  it('supports an unlimited list', () => {
    const items = Array.from({ length: 2500 }, (_, i) => String(i));
    expect(normalizeFseibanList(items, Number.POSITIVE_INFINITY)).toEqual(items);
  });
});
