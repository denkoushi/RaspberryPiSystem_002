import { describe, expect, it } from 'vitest';

import { PART_SEARCH_DIGITS, PART_SEARCH_PALETTE_KEYS, PART_SEARCH_PRESETS } from '../partSearchPaletteDefinition';
import { computeHiddenPaletteKeys } from '../partSearchPalettePruner';

import type { PartPlacementSearchHitDto } from '../types';

describe('PART_SEARCH_PALETTE_KEYS', () => {
  it('includes digit keys and V19 preset tokens for pruner and palette', () => {
    expect(PART_SEARCH_DIGITS).toEqual(['0', '1', '2', '3', '4', '5', '6', '7', '8', '9']);
    expect(PART_SEARCH_PRESETS).toContain('ナット');
    expect(PART_SEARCH_PRESETS).toContain('モータ');
    expect(PART_SEARCH_PALETTE_KEYS).toContain('0');
    expect(PART_SEARCH_PALETTE_KEYS).toContain('9');
  });
});

describe('computeHiddenPaletteKeys', () => {
  it('does not hide any key when there are no hits', () => {
    const hidden = computeHiddenPaletteKeys('テ', [], PART_SEARCH_PALETTE_KEYS);
    expect(hidden.size).toBe(0);
  });

  it('hides keys that cannot extend to any displayed hit', () => {
    const hit: PartPlacementSearchHitDto = {
      matchSource: 'current',
      displayName: 'テーブル脚',
      matchedQuery: 'テ',
      aliasMatchedBy: null,
      shelfCodeRaw: 'A-1',
      manufacturingOrderBarcodeRaw: null,
      branchNo: 1,
      branchStateId: 'b1',
      csvDashboardRowId: null,
      fhincd: 'X',
      fhinmei: 'テーブル脚',
      fseiban: null,
      productNo: null
    };
    const hidden = computeHiddenPaletteKeys('テーブル', [hit], PART_SEARCH_PALETTE_KEYS);
    expect(hidden.has('ボルト')).toBe(true);
    expect(hidden.has('脚')).toBe(false);
    expect(hidden.has(' ')).toBe(false);
  });
});
