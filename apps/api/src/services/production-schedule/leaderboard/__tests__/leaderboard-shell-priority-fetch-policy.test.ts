import { describe, expect, it } from 'vitest';

import {
  computeLeaderboardShellPriorityFetchPlan,
  resolveLeaderboardShellSkipExpansionAfterManual,
  trimLeaderboardShellManualProbeRows,
} from '../leaderboard-shell-priority-fetch-policy.js';

describe('computeLeaderboardShellPriorityFetchPlan', () => {
  it('prefixLimit なしでは manual 無制限・expansion スキップしない', () => {
    expect(computeLeaderboardShellPriorityFetchPlan({})).toEqual({
      manualSqlLimit: null,
      skipExpansionAfterManual: false,
    });
  });

  it('prefixLimit ありでは manual を prefixLimit + 1 件まで取得する', () => {
    expect(computeLeaderboardShellPriorityFetchPlan({ prefixLimit: 80 })).toEqual({
      manualSqlLimit: 81,
      skipExpansionAfterManual: false,
    });
  });
});

describe('resolveLeaderboardShellSkipExpansionAfterManual', () => {
  it('prefixLimit なしでは expansion をスキップしない', () => {
    expect(
      resolveLeaderboardShellSkipExpansionAfterManual({ manualRowCount: 100 })
    ).toBe(false);
  });

  it('manual 件数 >= prefixLimit なら expansion をスキップする', () => {
    expect(
      resolveLeaderboardShellSkipExpansionAfterManual({ prefixLimit: 80, manualRowCount: 80 })
    ).toBe(true);
    expect(
      resolveLeaderboardShellSkipExpansionAfterManual({ prefixLimit: 80, manualRowCount: 81 })
    ).toBe(true);
  });

  it('manual 件数 < prefixLimit なら expansion を実行する', () => {
    expect(
      resolveLeaderboardShellSkipExpansionAfterManual({ prefixLimit: 80, manualRowCount: 79 })
    ).toBe(false);
  });
});

describe('trimLeaderboardShellManualProbeRows', () => {
  it('prefixLimit なしでは行を切り詰めない', () => {
    const rows = [1, 2, 3];
    expect(trimLeaderboardShellManualProbeRows({ rows })).toEqual([1, 2, 3]);
  });

  it('probe 分 1 件多い manual を prefixLimit に切り詰める', () => {
    const rows = ['a', 'b', 'c'];
    expect(trimLeaderboardShellManualProbeRows({ prefixLimit: 2, rows })).toEqual(['a', 'b']);
  });

  it('件数 <= prefixLimit ならそのまま返す', () => {
    const rows = ['a', 'b'];
    expect(trimLeaderboardShellManualProbeRows({ prefixLimit: 2, rows })).toEqual(['a', 'b']);
  });
});
