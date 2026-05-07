import { describe, expect, it } from 'vitest';

import {
  compareLeaderboardFetchedRows,
  mergeLeaderboardShellPriorityAndFillerUpTo,
  type LeaderboardScheduleRowSql,
} from '../leaderboard/leaderboard-row-selection.service.js';
import { buildMaxProductNoLogicalKeyPartitionExprs } from '../row-resolver/max-product-no-winner-spec.js';

const row = (
  id: string,
  fseiban: string,
  productNo: string,
  processingOrder: number | null,
  due: Date | null
): LeaderboardScheduleRowSql => ({
  id,
  seibanJoinKey: fseiban,
  occurredAt: new Date(),
  rowData: {
    ProductNo: productNo,
    FSEIBAN: fseiban,
    FHINCD: 'X',
    FSIGENCD: 'R01',
    FKOJUN: '1',
    progress: '',
  },
  processingOrder,
  globalRank: null,
  note: null,
  processingType: null,
  dueDate: due,
  plannedQuantity: null,
  plannedStartDate: null,
  plannedEndDate: null,
});

describe('winner logical key specification (parity helper)', () => {
  it('logical key PARTITION 式に製番〜工順キーが含まれる', () => {
    const exprs = buildMaxProductNoLogicalKeyPartitionExprs('t');
    expect(exprs).toContain('FSEIBAN');
    expect(exprs).toContain('FHINCD');
    expect(exprs).toContain('FSIGENCD');
    expect(exprs).toContain('FKOJUN');
  });
});

describe('compareLeaderboardFetchedRows', () => {
  it('手動順位ありを先にし、番号昇順にする', () => {
    const a = row('a', 'S', '0002', 2, new Date('2026-01-01'));
    const b = row('b', 'S', '0001', 1, new Date('2026-01-01'));
    const list = [a, b].sort(compareLeaderboardFetchedRows);
    expect(list.map((r) => r.id)).toEqual(['b', 'a']);
  });

  it('手動なし同士では納期が早い方を先にする', () => {
    const late = row('a', 'S', '0001', null, new Date('2026-06-01'));
    const early = row('b', 'S', '0001', null, new Date('2026-03-01'));
    const list = [late, early].sort(compareLeaderboardFetchedRows);
    expect(list.map((r) => r.id)).toEqual(['b', 'a']);
  });

  it('同一納期・製番・品番では工順数値と品目コードで安定化する', () => {
    const a = {
      ...row('c', 'S', '0001', null, new Date('2026-03-01')),
      rowData: { ProductNo: '0001', FSEIBAN: 'S', FHINCD: 'B', FSIGENCD: 'R01', FKOJUN: '20', progress: '' },
    };
    const b = {
      ...row('b', 'S', '0001', null, new Date('2026-03-01')),
      rowData: { ProductNo: '0001', FSEIBAN: 'S', FHINCD: 'A', FSIGENCD: 'R01', FKOJUN: '10', progress: '' },
    };
    const c = {
      ...row('a', 'S', '0001', null, new Date('2026-03-01')),
      rowData: { ProductNo: '0001', FSEIBAN: 'S', FHINCD: 'A', FSIGENCD: 'R01', FKOJUN: '20', progress: '' },
    };
    const list = [a, b, c].sort(compareLeaderboardFetchedRows);
    expect(list.map((r) => r.id)).toEqual(['b', 'a', 'c']);
  });
});

describe('mergeLeaderboardShellPriorityAndFillerUpTo', () => {
  it('prefix マージは全件マージの先頭 N 件と一致する', () => {
    const manualEarly = row('m1', 'S', '0001', 1, new Date('2026-06-01'));
    const manualLate = row('m2', 'S', '0002', 2, new Date('2026-01-01'));
    const fillerA = row('f1', 'T', '0001', null, new Date('2026-02-01'));
    const fillerB = row('f2', 'T', '0002', null, new Date('2026-03-01'));
    const pSorted = [manualEarly, manualLate].sort(compareLeaderboardFetchedRows);
    const fillerRows = [fillerA, fillerB].sort(compareLeaderboardFetchedRows);

    const full = mergeLeaderboardShellPriorityAndFillerUpTo(
      pSorted,
      fillerRows,
      1_000
    ).rows;
    for (let n = 0; n <= full.length; n++) {
      const prefix = mergeLeaderboardShellPriorityAndFillerUpTo(pSorted, fillerRows, n).rows;
      expect(prefix).toEqual(full.slice(0, n));
    }
    const { mergeFullyCompleted: doneEarly } = mergeLeaderboardShellPriorityAndFillerUpTo(
      pSorted,
      fillerRows,
      2
    );
    expect(doneEarly).toBe(false);
    const { mergeFullyCompleted: doneAll } = mergeLeaderboardShellPriorityAndFillerUpTo(
      pSorted,
      fillerRows,
      1_000
    );
    expect(doneAll).toBe(true);
  });
});
