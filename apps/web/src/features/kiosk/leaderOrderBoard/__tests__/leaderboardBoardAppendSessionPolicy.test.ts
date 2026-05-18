import { describe, expect, it } from 'vitest';

import {
  resolveLeaderboardAppendLoopStartBoard,
  shouldBeginLeaderboardAppendSession
} from '../leaderboardBoardAppendSessionPolicy';

import type { ProductionScheduleLeaderboardBoardResponse, ProductionScheduleRow } from '../../../../api/client';

function row(id: string): ProductionScheduleRow {
  return { id, rowData: { FSIGENCD: 'R1' } } as unknown as ProductionScheduleRow;
}

function board(rows: ProductionScheduleRow[], hasMore: boolean): ProductionScheduleLeaderboardBoardResponse {
  return {
    page: 1,
    pageSize: 20,
    total: rows.length,
    rows,
    resources: [{ resourceCd: 'R1', hasMore, total: 10, pageSize: 20, nextCursor: rows.length }]
  };
}

describe('shouldBeginLeaderboardAppendSession', () => {
  const paramsKey = 'k1';
  const fp = 'fp-shell';

  it('追補完了済み params では開始しない', () => {
    expect(
      shouldBeginLeaderboardAppendSession({
        paramsKey,
        appendCompleteForParamsKey: paramsKey,
        appendCompleteShellFingerprint: fp,
        shellFingerprint: fp,
        lastStartedShellFingerprint: null,
        shell: board([row('a')], true),
        appendOverride: null,
        retryNonce: 0,
        lastRetryNonceStarted: 0
      })
    ).toBe(false);
  });

  it('params 同一でも shell 指紋が変われば再追補する', () => {
    expect(
      shouldBeginLeaderboardAppendSession({
        paramsKey,
        appendCompleteForParamsKey: paramsKey,
        appendCompleteShellFingerprint: 'old-fp',
        shellFingerprint: 'new-fp',
        lastStartedShellFingerprint: 'old-fp',
        shell: board([row('a'), row('b')], true),
        appendOverride: null,
        retryNonce: 0,
        lastRetryNonceStarted: 0
      })
    ).toBe(true);
  });

  it('追補途中（override が shell より行数多い）では開始しない', () => {
    expect(
      shouldBeginLeaderboardAppendSession({
        paramsKey,
        appendCompleteForParamsKey: null,
        appendCompleteShellFingerprint: null,
        shellFingerprint: fp,
        lastStartedShellFingerprint: fp,
        shell: board([row('a'), row('b')], true),
        appendOverride: board([row('a'), row('b'), row('c')], true),
        retryNonce: 0,
        lastRetryNonceStarted: 0
      })
    ).toBe(false);
  });

  it('同一指紋で override 無し・retry 増分時は再試行する', () => {
    expect(
      shouldBeginLeaderboardAppendSession({
        paramsKey,
        appendCompleteForParamsKey: null,
        appendCompleteShellFingerprint: null,
        shellFingerprint: fp,
        lastStartedShellFingerprint: fp,
        shell: board([row('a')], true),
        appendOverride: null,
        retryNonce: 2,
        lastRetryNonceStarted: 1
      })
    ).toBe(true);
  });
});

describe('resolveLeaderboardAppendLoopStartBoard', () => {
  it('追補途中なら override から再開する', () => {
    const shell = board([row('a')], true);
    const override = board([row('a'), row('b')], true);
    const start = resolveLeaderboardAppendLoopStartBoard(shell, override);
    expect(start.rows.map((r) => r.id)).toEqual(['a', 'b']);
  });
});
