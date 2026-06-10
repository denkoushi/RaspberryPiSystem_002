import { describe, expect, it } from 'vitest';

import { compareLeaderBoardRowsForSeibanEvalDisplay } from '../sortLeaderBoardRowsForSeibanEvalDisplay';

import { mkLeaderBoardRow } from './leaderBoardRowTestFixtures';

import type { LeaderBoardRow } from '../types';

const row = (id: string, fseiban: string, processingOrder: number | null, displayDue: string | null): LeaderBoardRow =>
  mkLeaderBoardRow({
    id,
    seibanJoinKey: fseiban,
    resourceCd: 'R1',
    displayDue,
    fseiban,
    productNo: '1',
    fkojun: '1',
    fhincd: 'K',
    machineName: 'M',
    processingOrder
  });

describe('compareLeaderBoardRowsForSeibanEvalDisplay', () => {
  it('orders by seiban rank before processingOrder', () => {
    const rank = new Map([
      ['S1', 0],
      ['S2', 1]
    ]);
    const a = row('a', 'S2', 1, '2026-04-10');
    const b = row('b', 'S1', null, '2026-04-01');
    expect(compareLeaderBoardRowsForSeibanEvalDisplay(rank, b, a)).toBeLessThan(0);
    expect(compareLeaderBoardRowsForSeibanEvalDisplay(rank, a, b)).toBeGreaterThan(0);
  });

  it('delegates to processing order when seiban rank ties', () => {
    const rank = new Map([['S1', 0]]);
    const a = row('a', 'S1', 2, '2026-04-01');
    const b = row('b', 'S1', 1, '2026-04-10');
    expect(compareLeaderBoardRowsForSeibanEvalDisplay(rank, b, a)).toBeLessThan(0);
  });
});
