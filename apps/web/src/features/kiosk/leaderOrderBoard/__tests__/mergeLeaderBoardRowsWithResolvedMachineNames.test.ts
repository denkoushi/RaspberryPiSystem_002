import { describe, expect, it } from 'vitest';

import { mergeLeaderBoardRowsWithResolvedMachineNames } from '../mergeLeaderBoardRowsWithResolvedMachineNames';

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
  isCompleted: false,
  note: null
});

describe('mergeLeaderBoardRowsWithResolvedMachineNames', () => {
  it('fills empty machineName from API map only', () => {
    const m = new Map<string, string>([['S1', '機種Z']]);
    const out = mergeLeaderBoardRowsWithResolvedMachineNames([row('S1', ''), row('S1', '既存')], m);
    expect(out[0].machineName).toBe('機種Z');
    expect(out[1].machineName).toBe('既存');
  });
});
