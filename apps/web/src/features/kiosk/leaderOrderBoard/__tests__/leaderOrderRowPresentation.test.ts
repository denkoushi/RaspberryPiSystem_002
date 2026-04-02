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
  isCompleted: false,
  note: null
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

  it('normalizes machine name to half-width uppercase like other kiosk pages', () => {
    const p = presentLeaderOrderRow({ ...base(), machineName: '  abcｘｙｚ  ' });
    expect(p.machinePartLine).toBe('ABCXYZ · P99 · MH001');
  });

  it('process line uses kojun dot part name without labels', () => {
    const p = presentLeaderOrderRow(base());
    expect(p.processPartNameLine).toBe('10 · 部品A');
  });

  it('formats quantity inline Japanese suffix', () => {
    expect(presentLeaderOrderRow(base()).quantityInlineJa).toBe('3個');
    expect(presentLeaderOrderRow({ ...base(), plannedQuantity: null }).quantityInlineJa).toBeNull();
    expect(presentLeaderOrderRow({ ...base(), plannedQuantity: -1 }).quantityInlineJa).toBe('-1個');
  });
});
