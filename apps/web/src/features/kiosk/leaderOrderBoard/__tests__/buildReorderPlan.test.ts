import { describe, expect, it } from 'vitest';

import { buildReorderPlan } from '../buildReorderPlan';

import type { LeaderBoardRow } from '../types';

const base = (id: string, po: number | null): LeaderBoardRow => ({
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
  processingOrder: po,
  isCompleted: false,
  note: null
});

describe('buildReorderPlan', () => {
  it('processingOrder がある行を先に clear し、その後 assign 1..n', () => {
    const sorted = [base('a', 2), base('b', null), base('c', 1)];
    const steps = buildReorderPlan(sorted, '305');
    expect(steps).toEqual([
      { kind: 'clear', rowId: 'a', resourceCd: '305' },
      { kind: 'clear', rowId: 'c', resourceCd: '305' },
      { kind: 'assign', rowId: 'a', resourceCd: '305', orderNumber: 1 },
      { kind: 'assign', rowId: 'b', resourceCd: '305', orderNumber: 2 },
      { kind: 'assign', rowId: 'c', resourceCd: '305', orderNumber: 3 }
    ]);
  });
});
