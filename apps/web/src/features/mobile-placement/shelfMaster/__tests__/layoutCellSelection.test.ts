import { describe, expect, it } from 'vitest';

import {
  normalizeCellIndices,
  toggleLayoutCellSelection
} from '../model/layoutCellSelection';

describe('normalizeCellIndices', () => {
  it('sorts and deduplicates', () => {
    expect(normalizeCellIndices([4, 1, 1, 0])).toEqual([0, 1, 4]);
  });
});

describe('toggleLayoutCellSelection', () => {
  it('returns prev when clickedCells is empty', () => {
    expect(
      toggleLayoutCellSelection({
        prevSelected: [1, 2],
        clickedCells: [],
        multiMode: true
      })
    ).toEqual([1, 2]);
  });

  describe('single cell', () => {
    it('non-multi: selects one cell or clears when same cell clicked again', () => {
      expect(
        toggleLayoutCellSelection({
          prevSelected: [],
          clickedCells: [4],
          multiMode: false
        })
      ).toEqual([4]);

      expect(
        toggleLayoutCellSelection({
          prevSelected: [4],
          clickedCells: [4],
          multiMode: false
        })
      ).toEqual([]);

      expect(
        toggleLayoutCellSelection({
          prevSelected: [4],
          clickedCells: [2],
          multiMode: false
        })
      ).toEqual([2]);
    });

    it('multi: toggles cell in selection', () => {
      expect(
        toggleLayoutCellSelection({
          prevSelected: [1],
          clickedCells: [4],
          multiMode: true
        })
      ).toEqual([1, 4]);

      expect(
        toggleLayoutCellSelection({
          prevSelected: [1, 4],
          clickedCells: [4],
          multiMode: true
        })
      ).toEqual([1]);
    });
  });

  describe('merged block (multiple cells)', () => {
    const block = [0, 1, 2];

    it('selects all block cells when not fully selected', () => {
      expect(
        toggleLayoutCellSelection({
          prevSelected: [],
          clickedCells: block,
          multiMode: false
        })
      ).toEqual([0, 1, 2]);

      expect(
        toggleLayoutCellSelection({
          prevSelected: [5],
          clickedCells: block,
          multiMode: true
        })
      ).toEqual([0, 1, 2, 5]);
    });

    it('unions remaining block cells when only partially selected', () => {
      expect(
        toggleLayoutCellSelection({
          prevSelected: [0, 1],
          clickedCells: block,
          multiMode: true
        })
      ).toEqual([0, 1, 2]);
    });

    it('deselects all block cells when fully selected', () => {
      expect(
        toggleLayoutCellSelection({
          prevSelected: [0, 1, 2],
          clickedCells: block,
          multiMode: false
        })
      ).toEqual([]);

      expect(
        toggleLayoutCellSelection({
          prevSelected: [0, 1, 2, 5],
          clickedCells: block,
          multiMode: true
        })
      ).toEqual([5]);
    });
  });
});
