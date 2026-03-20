import { describe, expect, it } from 'vitest';

import {
  buildConditionsAfterPencilFromFirstResourceCd,
  mergeManualOrderPencilPreservedSearchFields
} from './manualOrderLowerPaneSearch';
import { DEFAULT_SEARCH_CONDITIONS } from './searchConditions';

describe('buildConditionsAfterPencilFromFirstResourceCd', () => {
  it('研削資源CDでは研削のみON・切削OFF・資源が1件', () => {
    const next = buildConditionsAfterPencilFromFirstResourceCd('305');
    expect(next.showGrindingResources).toBe(true);
    expect(next.showCuttingResources).toBe(false);
    expect(next.activeResourceCds).toEqual(['305']);
    expect(next).toMatchObject({
      ...DEFAULT_SEARCH_CONDITIONS,
      showGrindingResources: true,
      showCuttingResources: false,
      activeResourceCds: ['305']
    });
  });

  it('切削扱いの資源CDでは切削のみON・研削OFF・資源が1件', () => {
    const next = buildConditionsAfterPencilFromFirstResourceCd('999');
    expect(next.showGrindingResources).toBe(false);
    expect(next.showCuttingResources).toBe(true);
    expect(next.activeResourceCds).toEqual(['999']);
    expect(next).toMatchObject({
      ...DEFAULT_SEARCH_CONDITIONS,
      showGrindingResources: false,
      showCuttingResources: true,
      activeResourceCds: ['999']
    });
  });

  it('前後の空白はトリムされる', () => {
    const next = buildConditionsAfterPencilFromFirstResourceCd('  305  ');
    expect(next.activeResourceCds).toEqual(['305']);
  });
});

describe('mergeManualOrderPencilPreservedSearchFields', () => {
  it('ベースの activeQueries を捨て、previous の登録製番選択を引き継ぐ', () => {
    const base = buildConditionsAfterPencilFromFirstResourceCd('305');
    const previous = {
      ...DEFAULT_SEARCH_CONDITIONS,
      activeQueries: ['A001', 'B002'],
      hasNoteOnlyFilter: true
    };
    const merged = mergeManualOrderPencilPreservedSearchFields(base, previous);
    expect(merged.activeQueries).toEqual(['A001', 'B002']);
    expect(merged.hasNoteOnlyFilter).toBe(false);
    expect(merged.activeResourceCds).toEqual(['305']);
    expect(merged.showGrindingResources).toBe(true);
  });

  it('activeQueries はコピーされ、ベース側の配列を mutate しても previous と結果が変わらない', () => {
    const base = { ...DEFAULT_SEARCH_CONDITIONS, activeQueries: [] as string[] };
    const previous = { ...DEFAULT_SEARCH_CONDITIONS, activeQueries: ['X'] };
    const merged = mergeManualOrderPencilPreservedSearchFields(base, previous);
    merged.activeQueries.push('Y');
    expect(previous.activeQueries).toEqual(['X']);
    expect(mergeManualOrderPencilPreservedSearchFields(base, previous).activeQueries).toEqual(['X']);
  });
});
