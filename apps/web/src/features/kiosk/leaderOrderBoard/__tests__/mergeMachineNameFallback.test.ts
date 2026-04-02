import { describe, expect, it } from 'vitest';

import {
  buildSeibanMachineNameMapFromProgressBySeiban,
  mergeMachineNameFallback
} from '../mergeMachineNameFallback';

import type { LeaderBoardRow } from '../types';

const row = (fseiban: string, machineName: string): LeaderBoardRow => ({
  id: fseiban,
  resourceCd: '305',
  dueDate: null,
  plannedEndDate: null,
  displayDue: null,
  fseiban,
  productNo: '',
  fkojun: '',
  fhincd: '',
  fhinmei: '',
  machineName,
  machineTypeCode: '',
  plannedQuantity: null,
  processingOrder: null,
  isCompleted: false
});

describe('mergeMachineNameFallback', () => {
  it('fills empty machineName from map only', () => {
    const fb = new Map<string, string>([['S1', '機種X']]);
    const out = mergeMachineNameFallback([row('S1', ''), row('S1', '既存')], fb);
    expect(out[0].machineName).toBe('機種X');
    expect(out[1].machineName).toBe('既存');
  });

  it('buildSeibanMachineNameMapFromProgressBySeiban skips empty names', () => {
    const m = buildSeibanMachineNameMapFromProgressBySeiban({
      A: { machineName: 'M1' },
      B: { machineName: '  ' }
    });
    expect(m.get('A')).toBe('M1');
    expect(m.has('B')).toBe(false);
  });
});
