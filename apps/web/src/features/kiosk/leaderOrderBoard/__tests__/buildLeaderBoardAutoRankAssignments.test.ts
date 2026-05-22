import { describe, expect, it } from 'vitest';

import {
  buildLeaderBoardAutoRankAssignments,
  pickAvailableOrderNumbers
} from '../buildLeaderBoardAutoRankAssignments';

import type { LeaderBoardRow } from '../types';

const base = (id: string, po: number | null, resourceCd = '305'): LeaderBoardRow => ({
  id,
  seibanJoinKey: '',
  resourceCd,
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

describe('pickAvailableOrderNumbers', () => {
  it('returns ascending unused numbers up to limit', () => {
    expect(pickAvailableOrderNumbers([1, 2], 5)).toEqual([3, 4, 5, 6, 7]);
  });

  it('returns empty when limit is 0', () => {
    expect(pickAvailableOrderNumbers([], 0)).toEqual([]);
  });
});

describe('buildLeaderBoardAutoRankAssignments', () => {
  it('assigns 3..7 when usage has 1 and 2', () => {
    const sorted = [
      base('a', null),
      base('b', null),
      base('c', null),
      base('d', null),
      base('e', null)
    ];
    const result = buildLeaderBoardAutoRankAssignments({
      resourceCd: '305',
      sortedRows: sorted,
      usageNumbers: [1, 2]
    });
    expect(result).toEqual([
      { rowId: 'a', resourceCd: '305', orderNumber: 3 },
      { rowId: 'b', resourceCd: '305', orderNumber: 4 },
      { rowId: 'c', resourceCd: '305', orderNumber: 5 },
      { rowId: 'd', resourceCd: '305', orderNumber: 6 },
      { rowId: 'e', resourceCd: '305', orderNumber: 7 }
    ]);
  });

  it('skips rows that already have processingOrder', () => {
    const sorted = [base('a', 1), base('b', null), base('c', null)];
    const result = buildLeaderBoardAutoRankAssignments({
      resourceCd: '305',
      sortedRows: sorted,
      usageNumbers: [1]
    });
    expect(result).toEqual([
      { rowId: 'b', resourceCd: '305', orderNumber: 2 },
      { rowId: 'c', resourceCd: '305', orderNumber: 3 }
    ]);
  });

  it('assigns only as many rows as unranked when fewer than max', () => {
    const sorted = [base('a', null), base('b', null), base('c', null)];
    const result = buildLeaderBoardAutoRankAssignments({
      resourceCd: '305',
      sortedRows: sorted,
      usageNumbers: []
    });
    expect(result).toHaveLength(3);
    expect(result.map((r) => r.orderNumber)).toEqual([1, 2, 3]);
  });

  it('assigns only as many numbers as available when fewer than unranked rows', () => {
    const sorted = [
      base('a', null),
      base('b', null),
      base('c', null),
      base('d', null),
      base('e', null)
    ];
    const result = buildLeaderBoardAutoRankAssignments({
      resourceCd: '305',
      sortedRows: sorted,
      usageNumbers: [1, 2, 3, 4, 5, 6, 7, 8]
    });
    expect(result).toEqual([
      { rowId: 'a', resourceCd: '305', orderNumber: 9 },
      { rowId: 'b', resourceCd: '305', orderNumber: 10 }
    ]);
  });

  it('returns empty when no unranked rows or no available numbers', () => {
    expect(
      buildLeaderBoardAutoRankAssignments({
        resourceCd: '305',
        sortedRows: [base('a', 1)],
        usageNumbers: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]
      })
    ).toEqual([]);
    expect(
      buildLeaderBoardAutoRankAssignments({
        resourceCd: '305',
        sortedRows: [],
        usageNumbers: []
      })
    ).toEqual([]);
  });

  it('ignores rows with mismatched resourceCd', () => {
    const sorted = [base('a', null, '999'), base('b', null, '305')];
    const result = buildLeaderBoardAutoRankAssignments({
      resourceCd: '305',
      sortedRows: sorted,
      usageNumbers: []
    });
    expect(result).toEqual([{ rowId: 'b', resourceCd: '305', orderNumber: 1 }]);
  });
});
