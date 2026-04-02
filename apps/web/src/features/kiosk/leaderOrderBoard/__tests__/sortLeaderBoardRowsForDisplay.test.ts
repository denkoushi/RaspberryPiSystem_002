import { describe, expect, it } from 'vitest';

import { sortLeaderBoardRowsForDisplay } from '../sortLeaderBoardRowsForDisplay';

import type { LeaderBoardRow } from '../types';

const row = (partial: Partial<LeaderBoardRow> & Pick<LeaderBoardRow, 'id'>): LeaderBoardRow => ({
  resourceCd: '305',
  dueDate: null,
  plannedEndDate: null,
  displayDue: null,
  fseiban: '',
  productNo: '',
  fkojun: '',
  fhincd: '',
  fhinmei: '',
  machineName: '',
  machineTypeCode: '',
  plannedQuantity: null,
  processingOrder: null,
  isCompleted: false,
  ...partial
});

describe('sortLeaderBoardRowsForDisplay', () => {
  it('places assigned processingOrder rows before unassigned, by order number', () => {
    const a = row({ id: 'a', processingOrder: 2, displayDue: '2026-04-10' });
    const b = row({ id: 'b', processingOrder: null, displayDue: '2026-04-01' });
    const c = row({ id: 'c', processingOrder: 1, displayDue: '2026-04-20' });
    expect(sortLeaderBoardRowsForDisplay([a, b, c]).map((r) => r.id)).toEqual(['c', 'a', 'b']);
  });

  it('within unassigned, sorts by display due like sortRowsByDisplayDue', () => {
    const a = row({ id: 'a', processingOrder: null, displayDue: '2026-04-20' });
    const b = row({ id: 'b', processingOrder: null, displayDue: '2026-04-05' });
    expect(sortLeaderBoardRowsForDisplay([a, b]).map((r) => r.id)).toEqual(['b', 'a']);
  });
});
