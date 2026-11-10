import { describe, expect, it } from 'vitest';

import {
  MACRO_ZONE_CATALOG,
  PARTS_SHELF_ZONE_DIR_LABEL,
  allocateShelfCode,
  areOrthogonallyAdjacent,
  buildAutoDisplayLabel,
  dedupeDisplayLabel,
  directionBetween,
  formatShelfCodeRaw,
  getMacroZoneById,
  getNeighborMacroZoneId,
  indexToRc,
  macroZoneIdFromStructured,
  nearestMachineDirection,
  rcToIndex,
  shelfPrefixForMacroZone,
  validateAdjacentRectangle,
  type MacroZoneId
} from './index.js';

describe('macro zone catalog', () => {
  it('covers each (area, line) pair exactly once on a 3x3 grid', () => {
    expect(MACRO_ZONE_CATALOG).toHaveLength(9);
    const cells = new Set(MACRO_ZONE_CATALOG.map((z) => `${z.factoryRow},${z.factoryCol}`));
    expect(cells.size).toBe(9);
    const pairs = new Set(MACRO_ZONE_CATALOG.map((z) => `${z.areaId}/${z.lineId}`));
    expect(pairs.size).toBe(9);
    for (const zone of MACRO_ZONE_CATALOG) {
      expect(macroZoneIdFromStructured(zone.areaId, zone.lineId)).toBe(zone.id);
      expect(Object.keys(PARTS_SHELF_ZONE_DIR_LABEL)).toContain(zone.id);
    }
  });

  it('resolves prefixes and throws for unknown ids', () => {
    expect(shelfPrefixForMacroZone('se')).toBe('東-南');
    expect(getMacroZoneById('c').displayName).toBe('中央·中央');
    expect(() => getMacroZoneById('zz' as MacroZoneId)).toThrow('Unknown macro zone: zz');
  });
});

describe('indexToRc / rcToIndex', () => {
  it('round-trips indices for 3x3 and 4x4 grids', () => {
    for (const size of [3, 4]) {
      for (let i = 0; i < size * size; i += 1) {
        const { r, c } = indexToRc(i, size);
        expect(rcToIndex(r, c, size)).toBe(i);
      }
    }
    expect(indexToRc(7, 4)).toEqual({ r: 1, c: 3 });
    expect(indexToRc(8, 3)).toEqual({ r: 2, c: 2 });
  });
});

describe('getNeighborMacroZoneId', () => {
  // factoryRow = エリア(西/中央/東)、factoryCol = 列(北/中央/南)。方向は画面グリッド上の
  // 上下左右（n = factoryRow-1）として扱われ、工場の方位名とは一致しない点を固定する。
  it('moves on the factory grid using row/col deltas', () => {
    expect(getNeighborMacroZoneId('c', 'n')).toBe('w');
    expect(getNeighborMacroZoneId('c', 's')).toBe('e');
    expect(getNeighborMacroZoneId('c', 'w')).toBe('n');
    expect(getNeighborMacroZoneId('c', 'e')).toBe('s');
    expect(getNeighborMacroZoneId('c', 'nw')).toBe('nw');
    expect(getNeighborMacroZoneId('c', 'se')).toBe('se');
  });

  it('returns null at the grid edges', () => {
    expect(getNeighborMacroZoneId('nw', 'n')).toBeNull();
    expect(getNeighborMacroZoneId('nw', 'w')).toBeNull();
    expect(getNeighborMacroZoneId('se', 'se')).toBeNull();
    expect(getNeighborMacroZoneId('se', 'e')).toBeNull();
    expect(getNeighborMacroZoneId('nw', 'se')).toBe('c');
  });
});

describe('directionBetween tie-breaking', () => {
  it('prefers north/south on equal diagonal distance', () => {
    expect(directionBetween(1, 1, 0, 0)).toBe('北');
    expect(directionBetween(1, 1, 0, 2)).toBe('北');
    expect(directionBetween(1, 1, 2, 0)).toBe('南');
    expect(directionBetween(1, 1, 2, 2)).toBe('南');
  });

  it('uses the dominant axis otherwise', () => {
    expect(directionBetween(0, 0, 1, 3)).toBe('東');
    expect(directionBetween(0, 3, 1, 0)).toBe('西');
    expect(directionBetween(0, 0, 3, 1)).toBe('南');
  });
});

describe('nearestMachineDirection', () => {
  it('returns null without machines or cells', () => {
    expect(nearestMachineDirection([], 3, [{ resourceName: 'M', r: 0, c: 0 }], indexToRc)).toBeNull();
    expect(nearestMachineDirection([0], 3, [], indexToRc)).toBeNull();
  });

  it('uses the centroid of the cells and Manhattan distance', () => {
    // cells 0,1 (r=0, c=0..1) -> centroid (0, 0.5)
    const result = nearestMachineDirection(
      [0, 1],
      3,
      [
        { resourceName: 'FAR', r: 2, c: 2 },
        { resourceName: 'NEAR', r: 2, c: 0 }
      ],
      indexToRc
    );
    expect(result).toEqual({ resourceName: 'NEAR', direction: '北' });
  });

  it('keeps the first machine on equal distance', () => {
    const result = nearestMachineDirection(
      [4],
      3,
      [
        { resourceName: 'WEST', r: 1, c: 0 },
        { resourceName: 'EAST', r: 1, c: 2 }
      ],
      indexToRc
    );
    expect(result).toEqual({ resourceName: 'WEST', direction: '東' });
  });
});

describe('buildAutoDisplayLabel', () => {
  it('appends a direction relative to the nearest machine and dedupes within the zone', () => {
    expect(
      buildAutoDisplayLabel({
        cellIndices: [2],
        gridSize: 3,
        machines: [{ resourceName: 'NC01', r: 1, c: 1 }],
        existingLabelsInZone: ['NC01北']
      })
    ).toBe('NC01北-2');
  });

  it('dedupe skips already used suffixes', () => {
    expect(dedupeDisplayLabel('置場-中央', ['置場-中央', '置場-中央-2', '置場-中央-3'])).toBe('置場-中央-4');
    expect(dedupeDisplayLabel('置場-中央', ['置場-中央-2'])).toBe('置場-中央');
  });
});

describe('validateAdjacentRectangle edge cases', () => {
  it('rejects empty input and out-of-bounds or non-integer indices', () => {
    expect(validateAdjacentRectangle([], 3)).toEqual({ ok: false, reason: 'EMPTY_CELLS' });
    expect(validateAdjacentRectangle([9], 3)).toEqual({ ok: false, reason: 'OUT_OF_BOUNDS' });
    expect(validateAdjacentRectangle([-1], 4)).toEqual({ ok: false, reason: 'OUT_OF_BOUNDS' });
    expect(validateAdjacentRectangle([1.5], 4)).toEqual({ ok: false, reason: 'OUT_OF_BOUNDS' });
    expect(validateAdjacentRectangle([15], 4)).toEqual({ ok: true, normalizedIndices: [15] });
  });

  it('dedupes and sorts indices of a valid 2x2 block', () => {
    expect(validateAdjacentRectangle([5, 0, 4, 1, 0], 4)).toEqual({ ok: true, normalizedIndices: [0, 1, 4, 5] });
  });

  it('rejects L-shapes and row-wrapping sequences', () => {
    expect(validateAdjacentRectangle([0, 1, 3], 3)).toEqual({ ok: false, reason: 'NOT_RECTANGLE' });
    // 2 and 3 are consecutive indices but sit on different rows of a 3x3 grid
    expect(validateAdjacentRectangle([2, 3], 3)).toEqual({ ok: false, reason: 'NOT_RECTANGLE' });
  });
});

describe('areOrthogonallyAdjacent', () => {
  it('accepts edge neighbours only', () => {
    expect(areOrthogonallyAdjacent(0, 1, 3)).toBe(true);
    expect(areOrthogonallyAdjacent(0, 3, 3)).toBe(true);
    expect(areOrthogonallyAdjacent(0, 4, 3)).toBe(false);
    expect(areOrthogonallyAdjacent(2, 3, 3)).toBe(false);
    expect(areOrthogonallyAdjacent(4, 4, 3)).toBe(false);
  });
});

describe('shelf code allocation bounds', () => {
  it('formats slots 1..99 with two digits', () => {
    expect(formatShelfCodeRaw('西-北', 9)).toBe('西-北-09');
    expect(formatShelfCodeRaw('西-北', 99)).toBe('西-北-99');
  });

  it('rejects slots outside 1..99 and non-integers', () => {
    expect(() => formatShelfCodeRaw('西-北', 0)).toThrow(RangeError);
    expect(() => formatShelfCodeRaw('西-北', 100)).toThrow('slot must be 1..99');
    expect(() => formatShelfCodeRaw('西-北', 1.5)).toThrow(RangeError);
    expect(() => allocateShelfCode('西-北', 100)).toThrow('nextShelfSlot must be 1..99');
    expect(() => allocateShelfCode('西-北', 0)).toThrow('nextShelfSlot must be 1..99');
  });

  it('allocates the last slot and returns an out-of-range next slot (100)', () => {
    // 99 を払い出した後の nextShelfSlot=100 は次回呼び出しで RangeError になる
    expect(allocateShelfCode('東-南', 99)).toEqual({ shelfCodeRaw: '東-南-99', nextShelfSlot: 100 });
  });
});
