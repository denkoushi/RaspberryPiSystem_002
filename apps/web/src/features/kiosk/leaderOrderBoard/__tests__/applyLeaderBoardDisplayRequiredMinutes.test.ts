import { describe, expect, it } from 'vitest';

import {
  applyLeaderBoardDisplayRequiredMinutesToGrouped,
  applyLeaderBoardDisplayRequiredMinutesToRows,
  withLeaderBoardDisplayRequiredMinutes
} from '../applyLeaderBoardDisplayRequiredMinutes';

import { mkLeaderBoardRow } from './leaderBoardRowTestFixtures';

describe('applyLeaderBoardDisplayRequiredMinutes', () => {
  it('OFF uses machine minutes only', () => {
    const row = mkLeaderBoardRow({
      id: 'r1',
      machineRequiredMinutes: 400,
      laborRequiredMinutes: 175,
      requiredMinutes: 400
    });
    expect(withLeaderBoardDisplayRequiredMinutes(row, false).requiredMinutes).toBe(400);
  });

  it('ON adds labor minutes', () => {
    const row = mkLeaderBoardRow({
      id: 'r1',
      machineRequiredMinutes: 400,
      laborRequiredMinutes: 175,
      requiredMinutes: 400
    });
    expect(withLeaderBoardDisplayRequiredMinutes(row, true).requiredMinutes).toBe(575);
  });

  it('applies per slot index in grouped map', () => {
    const row021 = mkLeaderBoardRow({
      id: 'r021',
      resourceCd: '021',
      machineRequiredMinutes: 400,
      laborRequiredMinutes: 175,
      requiredMinutes: 400
    });
    const row305 = mkLeaderBoardRow({
      id: 'r305',
      resourceCd: '305',
      machineRequiredMinutes: 120,
      laborRequiredMinutes: 30,
      requiredMinutes: 120
    });
    const grouped = new Map([
      ['021', [row021]],
      ['305', [row305]]
    ]);
    const out = applyLeaderBoardDisplayRequiredMinutesToGrouped(
      grouped,
      ['021', '305'],
      [true, false]
    );
    expect(out.get('021')?.[0]?.requiredMinutes).toBe(575);
    expect(out.get('305')?.[0]?.requiredMinutes).toBe(120);
  });

  it('applyLeaderBoardDisplayRequiredMinutesToRows maps all rows', () => {
    const rows = [
      mkLeaderBoardRow({ id: 'a', machineRequiredMinutes: 10, laborRequiredMinutes: 5, requiredMinutes: 10 }),
      mkLeaderBoardRow({ id: 'b', machineRequiredMinutes: 20, laborRequiredMinutes: 0, requiredMinutes: 20 })
    ];
    const out = applyLeaderBoardDisplayRequiredMinutesToRows(rows, true);
    expect(out.map((r) => r.requiredMinutes)).toEqual([15, 20]);
  });
});
