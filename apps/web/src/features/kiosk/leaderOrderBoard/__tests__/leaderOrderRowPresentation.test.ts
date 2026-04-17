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
  it('joins machine type code, machine name, fseiban, fhincd with middle dots (no productNo)', () => {
    const p = presentLeaderOrderRow({ ...base(), machineTypeCode: 'DAD3350' });
    expect(p.machinePartLine).toBe('DAD3350 · 立マシンA · S1 · MH001');
    expect(p.clusterSegments).toEqual(['S1', 'MH001']);
    expect(p.machineTypeNameLine).toBe('DAD3350 · 立マシンA');
  });

  it('omits empty machine type code only', () => {
    const p = presentLeaderOrderRow(base());
    expect(p.machinePartLine).toBe('立マシンA · S1 · MH001');
    expect(p.clusterSegments).toEqual(['S1', 'MH001']);
    expect(p.machineTypeNameLine).toBe('立マシンA');
  });

  it('omits empty machine type and machine name; uses fseiban not productNo', () => {
    const row = { ...base(), machineName: '', machineTypeCode: '', fhincd: '' };
    const p = presentLeaderOrderRow(row);
    expect(p.machinePartLine).toBe('S1');
    expect(p.clusterSegments).toEqual(['S1']);
    expect(p.machineTypeNameLine).toBe('');
  });

  it('does not surface productNo in machine line when other fields are empty', () => {
    const row = { ...base(), machineName: '', machineTypeCode: '', fseiban: '', fhincd: '' };
    const p = presentLeaderOrderRow(row);
    expect(p.machinePartLine).toBe('');
    expect(p.machinePartLine).not.toContain('P99');
    expect(p.clusterSegments).toEqual([]);
    expect(p.machineTypeNameLine).toBe('');
  });

  it('normalizes machine name to half-width uppercase like other kiosk pages', () => {
    const p = presentLeaderOrderRow({ ...base(), machineName: '  abcｘｙｚ  ' });
    expect(p.machinePartLine).toBe('ABCXYZ · S1 · MH001');
    expect(p.machineTypeNameLine).toBe('ABCXYZ');
  });

  it('part name line is fhinmei only (kojun shown in card top row)', () => {
    const p = presentLeaderOrderRow(base());
    expect(p.partNameLine).toBe('部品A');
  });

  it('formats quantity inline Japanese suffix', () => {
    expect(presentLeaderOrderRow(base()).quantityInlineJa).toBe('3個');
    expect(presentLeaderOrderRow({ ...base(), plannedQuantity: null }).quantityInlineJa).toBeNull();
    expect(presentLeaderOrderRow({ ...base(), plannedQuantity: -1 }).quantityInlineJa).toBe('-1個');
  });
});
