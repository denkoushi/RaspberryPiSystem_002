import { describe, expect, it } from 'vitest';

import {
  fingerprintLeaderboardBoardShell,
  isLeaderboardScheduleInitialLoading,
  pickLeaderboardBoardForDisplay
} from '../leaderboardBoardDisplayPolicy';

import type { ProductionScheduleLeaderboardBoardResponse, ProductionScheduleRow } from '../../../../api/client';

function row(id: string): ProductionScheduleRow {
  return { id, rowData: { FSIGENCD: 'R1' } } as unknown as ProductionScheduleRow;
}

function board(rows: ProductionScheduleRow[], hasMore = false): ProductionScheduleLeaderboardBoardResponse {
  return {
    page: 1,
    pageSize: 80,
    total: rows.length,
    rows,
    resources: [{ resourceCd: 'R1', hasMore, total: rows.length, pageSize: 80 }]
  };
}

function boardWithTotal(
  rows: ProductionScheduleRow[],
  total: number,
  hasMore = false
): ProductionScheduleLeaderboardBoardResponse {
  return {
    ...board(rows, hasMore),
    total,
    resources: [{ resourceCd: 'R1', hasMore, total, pageSize: 80 }]
  };
}

function residualRow(
  id: string,
  completedResourceCd: string,
  completedStatus = 'C',
  productNo = 'P1',
  fkojun = '210'
): ProductionScheduleRow {
  return {
    ...row(id),
    processChangeResidualEvidence: {
      current: {
        productNo,
        fkojun,
        resourceCd: 'R1',
        status: 'R',
        fupdtedt: '2026-04-13T13:02:46.000Z'
      },
      completedOtherResource: {
        productNo,
        fkojun,
        resourceCd: completedResourceCd,
        status: completedStatus,
        fupdtedt: '2026-05-12T06:46:56.000Z'
      }
    }
  } as unknown as ProductionScheduleRow;
}

describe('pickLeaderboardBoardForDisplay', () => {
  it('追補済み行数が shell より多いときは追補結果を維持する', () => {
    const shell = boardWithTotal([row('a'), row('b')], 3, true);
    const override = boardWithTotal([row('a'), row('b'), row('c')], 3, true);
    const picked = pickLeaderboardBoardForDisplay(shell, override);
    expect(picked?.rows.map((r) => r.id)).toEqual(['a', 'b', 'c']);
  });

  it('snapshotId だけが変わった fresh shell では追補 override を維持する', () => {
    const shell = {
      ...boardWithTotal([row('a'), row('b')], 3, true),
      resources: [{ resourceCd: 'R1', hasMore: true, total: 3, pageSize: 80, snapshotId: 'fresh-snapshot' }]
    };
    const override = {
      ...boardWithTotal([row('a'), row('b'), row('c')], 3, true),
      resources: [{ resourceCd: 'R1', hasMore: false, total: 3, pageSize: 80, snapshotId: 'old-snapshot' }]
    };

    expect(pickLeaderboardBoardForDisplay(shell, override)).toBe(override);
  });

  it('fresh shell の残骸サマリーが変わったときは追補 override を破棄する', () => {
    const shell = {
      ...board([row('a'), row('b')], true),
      processChangeResidualTotal: 1,
      processChangeResidualRows: [row('x')]
    };
    const override = {
      ...board([row('a'), row('b'), row('c')], true),
      processChangeResidualTotal: 0,
      processChangeResidualRows: []
    };

    expect(pickLeaderboardBoardForDisplay(shell, override)).toBe(shell);
  });

  it('疑い行 ID が同じでも evidence が変わった fresh shell では追補 override を破棄する', () => {
    const shell = {
      ...boardWithTotal([row('a'), row('b')], 3, true),
      processChangeResidualTotal: 1,
      processChangeResidualRows: [residualRow('x', 'R9')]
    };
    const override = {
      ...boardWithTotal([row('a'), row('b'), row('c')], 3, true),
      processChangeResidualTotal: 1,
      processChangeResidualRows: [residualRow('x', 'R2')]
    };

    expect(pickLeaderboardBoardForDisplay(shell, override)).toBe(shell);
  });

  it('疑い行 ID と資源が同じでも ProductNo/FKOJUN が変わった fresh shell では追補 override を破棄する', () => {
    const shell = {
      ...boardWithTotal([row('a'), row('b')], 3, true),
      processChangeResidualTotal: 1,
      processChangeResidualRows: [residualRow('x', 'R2', 'C', 'P9', '999')]
    };
    const override = {
      ...boardWithTotal([row('a'), row('b'), row('c')], 3, true),
      processChangeResidualTotal: 1,
      processChangeResidualRows: [residualRow('x', 'R2', 'C', 'P1', '210')]
    };

    expect(pickLeaderboardBoardForDisplay(shell, override)).toBe(shell);
  });
});

describe('fingerprintLeaderboardBoardShell', () => {
  it('行 ID と resources が同じなら同一指紋', () => {
    const a = board([row('a'), row('b')], true);
    const b = board([row('a'), row('b')], true);
    expect(fingerprintLeaderboardBoardShell(a)).toBe(fingerprintLeaderboardBoardShell(b));
  });

  it('snapshotId が変わったら append 再走査用の shell 指紋は変わる', () => {
    const a = {
      ...boardWithTotal([row('a'), row('b')], 3, true),
      resources: [{ resourceCd: 'R1', hasMore: true, total: 3, pageSize: 80, snapshotId: 'snap-a' }]
    };
    const b = {
      ...boardWithTotal([row('a'), row('b')], 3, true),
      resources: [{ resourceCd: 'R1', hasMore: true, total: 3, pageSize: 80, snapshotId: 'snap-b' }]
    };
    expect(fingerprintLeaderboardBoardShell(a)).not.toBe(fingerprintLeaderboardBoardShell(b));
  });

  it('残骸メタが変わったら指紋も変わる', () => {
    const a = {
      ...board([row('a'), row('b')], true),
      processChangeResidualTotal: 0,
      processChangeResidualRows: []
    };
    const b = {
      ...board([row('a'), row('b')], true),
      processChangeResidualTotal: 1,
      processChangeResidualRows: [row('x')]
    };
    expect(fingerprintLeaderboardBoardShell(a)).not.toBe(fingerprintLeaderboardBoardShell(b));
  });

  it('残骸 evidence が変わったら指紋も変わる', () => {
    const a = {
      ...board([row('a'), row('b')], true),
      processChangeResidualTotal: 1,
      processChangeResidualRows: [residualRow('x', 'R2')]
    };
    const b = {
      ...board([row('a'), row('b')], true),
      processChangeResidualTotal: 1,
      processChangeResidualRows: [residualRow('x', 'R9')]
    };
    expect(fingerprintLeaderboardBoardShell(a)).not.toBe(fingerprintLeaderboardBoardShell(b));
  });

  it('残骸 evidence の ProductNo/FKOJUN が変わったら指紋も変わる', () => {
    const a = {
      ...board([row('a'), row('b')], true),
      processChangeResidualTotal: 1,
      processChangeResidualRows: [residualRow('x', 'R2', 'C', 'P1', '210')]
    };
    const b = {
      ...board([row('a'), row('b')], true),
      processChangeResidualTotal: 1,
      processChangeResidualRows: [residualRow('x', 'R2', 'C', 'P9', '999')]
    };
    expect(fingerprintLeaderboardBoardShell(a)).not.toBe(fingerprintLeaderboardBoardShell(b));
  });
});

describe('isLeaderboardScheduleInitialLoading', () => {
  it('行がある限り初回ローディングにしない', () => {
    expect(isLeaderboardScheduleInitialLoading(true, 3)).toBe(false);
    expect(isLeaderboardScheduleInitialLoading(true, 0)).toBe(true);
  });
});
