import { describe, expect, it } from 'vitest';

import { sortRowsByDisplayDue } from '../sortRowsByDisplayDue';

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
  customerName: '',
  machineName: '',
  machineTypeCode: '',
  plannedQuantity: null,
  processingOrder: null,
  isCompleted: false,
  note: null,
  ...partial
});

describe('sortRowsByDisplayDue', () => {
  it('昇順で並べ、納期なしは後ろへ', () => {
    const a = row({
      id: 'a',
      displayDue: '2026-04-20',
      fseiban: 'S1',
      resourceCd: '305'
    });
    const b = row({
      id: 'b',
      displayDue: '2026-04-10',
      fseiban: 'S1',
      resourceCd: '305'
    });
    const c = row({ id: 'c', displayDue: null, fseiban: 'S1', resourceCd: '305' });
    expect(sortRowsByDisplayDue([a, b, c]).map((r) => r.id)).toEqual(['b', 'a', 'c']);
  });

  it('同一納期は製番・ProductNo・工順で安定', () => {
    const input: LeaderBoardRow[] = [
      row({
        id: 'x',
        displayDue: '2026-04-10',
        fseiban: 'B',
        productNo: '2',
        fkojun: '10',
        resourceCd: '305'
      }),
      row({
        id: 'y',
        displayDue: '2026-04-10',
        fseiban: 'A',
        productNo: '10',
        fkojun: '5',
        resourceCd: '305'
      }),
      row({
        id: 'z',
        displayDue: '2026-04-10',
        fseiban: 'A',
        productNo: '10',
        fkojun: '20',
        resourceCd: '305'
      })
    ];
    expect(sortRowsByDisplayDue(input).map((r) => r.id)).toEqual(['y', 'z', 'x']);
  });
});
