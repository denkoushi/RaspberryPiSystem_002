import { describe, expect, it } from 'vitest';

import {
  allocateShelfCode,
  buildAutoDisplayLabel,
  dedupeDisplayLabel,
  directionBetween,
  macroZoneIdFromStructured,
  validateAdjacentRectangle
} from './index.js';

describe('directionBetween', () => {
  it('returns cardinal directions', () => {
    expect(directionBetween(1, 1, 0, 1)).toBe('北');
    expect(directionBetween(1, 1, 2, 1)).toBe('南');
    expect(directionBetween(1, 1, 1, 0)).toBe('西');
    expect(directionBetween(1, 1, 1, 2)).toBe('東');
    expect(directionBetween(1, 1, 1, 1)).toBe('中央');
  });
});

describe('validateAdjacentRectangle', () => {
  it('accepts single cell and 2x1 rectangle', () => {
    expect(validateAdjacentRectangle([4], 3)).toEqual({ ok: true, normalizedIndices: [4] });
    expect(validateAdjacentRectangle([1, 2], 3)).toEqual({ ok: true, normalizedIndices: [1, 2] });
  });

  it('rejects non-rectangle', () => {
    expect(validateAdjacentRectangle([0, 2], 3).ok).toBe(false);
  });
});

describe('buildAutoDisplayLabel', () => {
  it('uses machine name + direction', () => {
    const label = buildAutoDisplayLabel({
      cellIndices: [4],
      gridSize: 3,
      machines: [{ resourceName: 'Robodrill01', r: 1, c: 1 }],
      existingLabelsInZone: []
    });
    expect(label).toBe('Robodrill01中央');
  });

  it('uses 置場 when no machines', () => {
    const label = buildAutoDisplayLabel({
      cellIndices: [0],
      gridSize: 3,
      machines: [],
      existingLabelsInZone: []
    });
    expect(label).toBe('置場-中央');
  });
});

describe('dedupeDisplayLabel', () => {
  it('appends -2 suffix', () => {
    expect(dedupeDisplayLabel('Robodrill01南', ['Robodrill01南'])).toBe('Robodrill01南-2');
  });
});

describe('allocateShelfCode', () => {
  it('formats prefix and slot', () => {
    expect(allocateShelfCode('西-北', 1)).toEqual({
      shelfCodeRaw: '西-北-01',
      nextShelfSlot: 2
    });
  });
});

describe('macroZoneIdFromStructured', () => {
  it('maps west+north to nw', () => {
    expect(macroZoneIdFromStructured('west', 'north')).toBe('nw');
  });
});
