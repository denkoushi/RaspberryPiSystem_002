import { describe, expect, it } from 'vitest';

import {
  isLeaderboardShellReadyForAppend,
  resolveLeaderboardShellForDisplay,
  shouldSuppressLeaderboardShellPlaceholder
} from '../leaderboardBoardShellFreshnessPolicy';

import type { ProductionScheduleLeaderboardBoardResponse } from '../../../../api/client';

function shell(rows: number): ProductionScheduleLeaderboardBoardResponse {
  return {
    page: 1,
    pageSize: 80,
    total: rows,
    rows: Array.from({ length: rows }, (_, i) => ({ id: `r${i}` })) as ProductionScheduleLeaderboardBoardResponse['rows'],
    resources: []
  };
}

describe('shouldSuppressLeaderboardShellPlaceholder', () => {
  it('params 変更 + isPlaceholderData なら suppress', () => {
    expect(
      shouldSuppressLeaderboardShellPlaceholder({
        paramsKey: 'k2',
        isPlaceholderData: true,
        lastCommittedParamsKey: 'k1'
      })
    ).toBe(true);
  });

  it('params 同一 + isPlaceholderData なら suppress しない', () => {
    expect(
      shouldSuppressLeaderboardShellPlaceholder({
        paramsKey: 'k1',
        isPlaceholderData: true,
        lastCommittedParamsKey: 'k1'
      })
    ).toBe(false);
  });

  it('初回（lastCommitted 未確定）なら suppress しない', () => {
    expect(
      shouldSuppressLeaderboardShellPlaceholder({
        paramsKey: 'k1',
        isPlaceholderData: true,
        lastCommittedParamsKey: null
      })
    ).toBe(false);
  });

  it('本物のデータなら suppress しない', () => {
    expect(
      shouldSuppressLeaderboardShellPlaceholder({
        paramsKey: 'k2',
        isPlaceholderData: false,
        lastCommittedParamsKey: 'k1'
      })
    ).toBe(false);
  });
});

describe('resolveLeaderboardShellForDisplay', () => {
  it('suppress 時は undefined', () => {
    expect(resolveLeaderboardShellForDisplay(shell(3), true)).toBeUndefined();
  });

  it('非 suppress 時は shell を返す', () => {
    const s = shell(2);
    expect(resolveLeaderboardShellForDisplay(s, false)).toBe(s);
  });
});

describe('isLeaderboardShellReadyForAppend', () => {
  it('suppress 時は false', () => {
    expect(isLeaderboardShellReadyForAppend({ suppressPlaceholderShell: true, shell: shell(1) })).toBe(false);
  });

  it('shell あり・非 suppress なら true', () => {
    expect(isLeaderboardShellReadyForAppend({ suppressPlaceholderShell: false, shell: shell(1) })).toBe(true);
  });
});
