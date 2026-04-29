import { describe, expect, it } from 'vitest';

import { deriveVisibleSeibanEntries } from '../deriveVisibleSeibanEntries';

import type { LeaderBoardRow } from '../types';

const row = (id: string, fseiban: string, machineName: string, resourceCd = '305'): LeaderBoardRow => ({
  id,
  resourceCd,
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

describe('deriveVisibleSeibanEntries', () => {
  it('製番ごとに一意化し、最初の機種名を採用する', () => {
    const m = new Map<string, LeaderBoardRow[]>([
      ['305', [row('a', 'S1', '機種A'), row('b', 'S1', '機種上書きしない')]],
      ['306', [row('c', 'S2', '機種B')]]
    ]);
    expect(deriveVisibleSeibanEntries(m)).toEqual([
      { fseiban: 'S1', machineName: '機種A' },
      { fseiban: 'S2', machineName: '機種B' }
    ]);
  });

  it('空製番・空白のみの製番は除外する', () => {
    const m = new Map<string, LeaderBoardRow[]>([
      ['305', [row('a', '', ''), row('b', '   ', 'x'), row('c', 'OK', '機種')]]
    ]);
    expect(deriveVisibleSeibanEntries(m)).toEqual([{ fseiban: 'OK', machineName: '機種' }]);
  });

  it('機種名は trim 済み文字列として保持する', () => {
    const m = new Map<string, LeaderBoardRow[]>([
      ['305', [row('a', 'S1', '  機種  ')]]
    ]);
    expect(deriveVisibleSeibanEntries(m)).toEqual([{ fseiban: 'S1', machineName: '機種' }]);
  });
});
