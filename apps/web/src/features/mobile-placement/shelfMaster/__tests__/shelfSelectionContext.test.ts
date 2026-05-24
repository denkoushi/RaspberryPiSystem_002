import { describe, expect, it } from 'vitest';

import { resolveShelfSelectionContext } from '../zero2wPreset/shelfSelectionContext';

import type { DraftEntity } from '../model/shelfLayoutTypes';

const shelfA: DraftEntity = {
  entityKind: 'SHELF',
  cellIndices: [0],
  resourceCd: null,
  resourceName: null,
  shelfCodeRaw: 'NW-01',
  displayLabel: '棚A',
  aisleLabel: null
};

const shelfB: DraftEntity = {
  entityKind: 'SHELF',
  cellIndices: [1],
  resourceCd: null,
  resourceName: null,
  shelfCodeRaw: 'NW-02',
  displayLabel: '棚B',
  aisleLabel: null
};

const aisle: DraftEntity = {
  entityKind: 'AISLE',
  cellIndices: [2],
  resourceCd: null,
  resourceName: null,
  shelfCodeRaw: null,
  displayLabel: null,
  aisleLabel: '通路'
};

describe('resolveShelfSelectionContext', () => {
  it('returns none when nothing selected', () => {
    expect(resolveShelfSelectionContext([], [shelfA])).toEqual({ kind: 'none' });
  });

  it('returns empty when selecting unassigned cells', () => {
    expect(resolveShelfSelectionContext([2], [shelfA])).toEqual({ kind: 'empty' });
  });

  it('returns shelf for single SHELF entity selection', () => {
    expect(resolveShelfSelectionContext([0], [shelfA])).toEqual({
      kind: 'shelf',
      shelfCodeRaw: 'NW-01',
      displayLabel: '棚A',
      singleEntity: true
    });
  });

  it('returns none when multiple shelf entities are touched', () => {
    expect(resolveShelfSelectionContext([0, 1], [shelfA, shelfB])).toEqual({ kind: 'none' });
  });

  it('returns none when shelf and non-shelf are mixed', () => {
    expect(resolveShelfSelectionContext([0, 2], [shelfA, aisle])).toEqual({ kind: 'none' });
  });
});
