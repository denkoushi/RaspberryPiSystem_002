import { describe, expect, it } from 'vitest';

import { presentLeaderOrderRow } from '../leaderOrderRowPresentation';

import type { LeaderBoardRow } from '../types';

const base = (): LeaderBoardRow => ({
  id: '1',
  resourceCd: '305',
  dueDate: null,
  plannedEndDate: null,
  displayDue: null,
  fseiban: 'S1',
  productNo: 'P99',
  fkojun: '10',
  fhincd: 'MH001',
  fhinmei: '部品A',
  machineName: '立マシンA',
  machineTypeCode: '',
  plannedQuantity: 3,
  processingOrder: 1,
  isCompleted: false
});

describe('presentLeaderOrderRow', () => {
  it('joins machine type code, machine name, product no, fhincd with middle dots', () => {
    const p = presentLeaderOrderRow({ ...base(), machineTypeCode: 'DAD3350' });
    expect(p.machinePartLine).toBe('DAD3350 · 立マシンA · P99 · MH001');
  });

  it('omits empty machine type code only', () => {
    expect(presentLeaderOrderRow(base()).machinePartLine).toBe('立マシンA · P99 · MH001');
  });

  it('omits empty machine type and machine name', () => {
    const row = { ...base(), machineName: '', machineTypeCode: '', fhincd: '' };
    const p = presentLeaderOrderRow(row);
    expect(p.machinePartLine).toBe('P99');
  });

  it('process line uses kojun dot part name without labels', () => {
    const p = presentLeaderOrderRow(base());
    expect(p.processPartNameLine).toBe('10 · 部品A');
  });

  it('formats quantity', () => {
    expect(presentLeaderOrderRow(base()).quantityLabel).toBe('3');
    expect(presentLeaderOrderRow({ ...base(), plannedQuantity: null }).quantityLabel).toBe('-');
  });
});
