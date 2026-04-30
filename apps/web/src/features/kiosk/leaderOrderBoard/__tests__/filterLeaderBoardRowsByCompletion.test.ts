import { describe, expect, it } from 'vitest';

import { filterLeaderBoardRowsByCompletion } from '../filterLeaderBoardRowsByCompletion';

import type { LeaderBoardRow } from '../types';

const r = (id: string, isCompleted: boolean): LeaderBoardRow => ({
  id,
  resourceCd: '305',
  dueDate: null,
  plannedEndDate: null,
  displayDue: null,
  fseiban: '',
  productNo: '',
  fkojun: '',
  fhincd: '',
  fhinmei: '',
  customerName: '',
  machineName: '',
  machineTypeCode: '',
  plannedQuantity: null,
  processingOrder: null,
  isCompleted,
  note: null
});

describe('filterLeaderBoardRowsByCompletion', () => {
  it('filters complete and incomplete', () => {
    const rows = [r('a', false), r('b', true), r('c', false)];
    expect(filterLeaderBoardRowsByCompletion(rows, 'all').map((x) => x.id)).toEqual(['a', 'b', 'c']);
    expect(filterLeaderBoardRowsByCompletion(rows, 'complete').map((x) => x.id)).toEqual(['b']);
    expect(filterLeaderBoardRowsByCompletion(rows, 'incomplete').map((x) => x.id)).toEqual(['a', 'c']);
  });
});
