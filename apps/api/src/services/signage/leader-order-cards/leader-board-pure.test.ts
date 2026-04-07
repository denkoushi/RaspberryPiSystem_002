import { describe, expect, it } from 'vitest';

import {
  normalizeConfiguredResourceCds,
  sortLeaderBoardRowsForDisplaySignage,
  type SignageLeaderBoardRow,
} from './leader-board-pure.js';

describe('leader-board-pure', () => {
  it('normalizeConfiguredResourceCds dedupes and uppercases', () => {
    expect(normalizeConfiguredResourceCds([' aa ', 'AA', 'bb'])).toEqual(['AA', 'BB']);
  });

  it('sortLeaderBoardRowsForDisplaySignage orders by processingOrder then due', () => {
    const a: SignageLeaderBoardRow = {
      id: 'a',
      resourceCd: 'X',
      dueDate: null,
      plannedEndDate: null,
      displayDue: '2026-04-10T00:00:00.000Z',
      fseiban: 'S1',
      productNo: '1',
      fkojun: '1',
      fhincd: '',
      fhinmei: '',
      machineName: '',
      machineTypeCode: '',
      plannedQuantity: null,
      processingOrder: 2,
      isCompleted: false,
    };
    const b: SignageLeaderBoardRow = {
      ...a,
      id: 'b',
      processingOrder: 1,
      displayDue: '2026-04-11T00:00:00.000Z',
    };
    const sorted = sortLeaderBoardRowsForDisplaySignage([a, b]);
    expect(sorted.map((r) => r.id)).toEqual(['b', 'a']);
  });
});
