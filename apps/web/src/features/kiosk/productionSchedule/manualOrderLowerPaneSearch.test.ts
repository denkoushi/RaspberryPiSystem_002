import { describe, expect, it } from 'vitest';

import { buildConditionsAfterPencilFromFirstResourceCd } from './manualOrderLowerPaneSearch';
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
