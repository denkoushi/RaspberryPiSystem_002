import { describe, expect, it } from 'vitest';

import { buildPrefixedShelfCodes } from '../buildPrefixedShelfCodes';
import { DEFAULT_SHELF_ZONE_CATALOG } from '../defaultShelfZoneCatalog';
import { findZoneById } from '../findZoneById';
import { flattenShelfCodes } from '../flattenShelfCodes';

describe('buildPrefixedShelfCodes', () => {
  it('generates zero-padded codes', () => {
    expect(buildPrefixedShelfCodes('C', 3)).toEqual(['C-01', 'C-02', 'C-03']);
  });

  it('returns empty for non-positive or non-finite count', () => {
    expect(buildPrefixedShelfCodes('X', 0)).toEqual([]);
    expect(buildPrefixedShelfCodes('X', -1)).toEqual([]);
    expect(buildPrefixedShelfCodes('X', Number.POSITIVE_INFINITY)).toEqual([]);
  });
});

describe('flattenShelfCodes', () => {
  it('concatenates zone lists', () => {
    const flat = flattenShelfCodes(DEFAULT_SHELF_ZONE_CATALOG);
    expect(flat[0]).toBe('C-01');
    expect(flat.at(-1)).toBe('W-18');
    expect(flat).toHaveLength(54);
  });
});

describe('findZoneById', () => {
  it('returns the matching zone metadata', () => {
    expect(findZoneById(DEFAULT_SHELF_ZONE_CATALOG.zones, 'east')?.overlayTitle).toBe('東エリア');
  });
});
