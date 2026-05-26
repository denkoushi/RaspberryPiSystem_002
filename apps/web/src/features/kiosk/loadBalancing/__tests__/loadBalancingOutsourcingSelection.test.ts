import { describe, expect, it } from 'vitest';

import {
  listOverResourceCds,
  toggleSelectedResourceCd,
  toggleSelectedRowId
} from '../loadBalancingOutsourcingSelection';

describe('loadBalancingOutsourcingSelection', () => {
  it('超過資源を超過分降順で返す', () => {
    const result = listOverResourceCds([
      { resourceCd: 'B01', requiredMinutes: 100, availableMinutes: 120, overMinutes: 0, classCode: null },
      { resourceCd: 'A01', requiredMinutes: 240, availableMinutes: 180, overMinutes: 60, classCode: 'A' },
      { resourceCd: 'C01', requiredMinutes: 200, availableMinutes: 150, overMinutes: 50, classCode: 'C' }
    ]);

    expect(result).toEqual(['A01', 'C01']);
  });

  it('資源CDと rowId をトグルできる', () => {
    expect(toggleSelectedResourceCd(['A01'], 'B01')).toEqual(['A01', 'B01']);
    expect(toggleSelectedResourceCd(['A01', 'B01'], 'A01')).toEqual(['B01']);
    expect(toggleSelectedRowId(['row-1'], 'row-2')).toEqual(['row-1', 'row-2']);
    expect(toggleSelectedRowId(['row-1', 'row-2'], 'row-1')).toEqual(['row-2']);
  });
});
