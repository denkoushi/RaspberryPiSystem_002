import type { ProductionScheduleLeaderboardBoardResponse } from '../../../api/client';

export type LeaderboardAppendSessionGateInput = {
  paramsKey: string;
  /** この paramsKey で追補ループが完了済みか */
  appendCompleteForParamsKey: string | null;
  /** 完了時の shell 指紋（params 同一でもサーバ応答が変われば再追補する） */
  appendCompleteShellFingerprint: string | null;
  shellFingerprint: string;
  /** 直近に開始したセッションの shell 指紋 */
  lastStartedShellFingerprint: string | null;
  shell: ProductionScheduleLeaderboardBoardResponse;
  appendOverride: ProductionScheduleLeaderboardBoardResponse | null;
  /** 直前の continue が失敗し override が無いとき、refetch で再試行する */
  retryNonce: number;
  lastRetryNonceStarted: number;
};

/**
 * 新しい continue 追補セッションを開始すべきか。
 * - params 変更後の初回 / shell 内容変化 / 追補未完了で override 無しの再試行 のみ true。
 * - 同一 shell 指紋で追補途中（override が shell より行数多い）なら false（refetch 巻き戻し防止）。
 */
export function shouldBeginLeaderboardAppendSession(input: LeaderboardAppendSessionGateInput): boolean {
  const hasPendingWork =
    input.shell.resources.some((r) => r.hasMore) || input.shell.residualSummaryDeferred === true;
  if (!hasPendingWork) return false;

  if (
    input.appendCompleteForParamsKey === input.paramsKey &&
    input.appendCompleteShellFingerprint === input.shellFingerprint
  ) {
    return false;
  }

  if (input.lastStartedShellFingerprint === input.shellFingerprint) {
    const overrideAhead =
      input.appendOverride != null && input.appendOverride.rows.length > input.shell.rows.length;
    if (overrideAhead) return false;
    if (input.appendOverride != null) return false;
    return input.retryNonce !== input.lastRetryNonceStarted;
  }

  return true;
}

/** continue ループの開始点: 追補途中なら override、それ以外は shell */
export function resolveLeaderboardAppendLoopStartBoard(
  shell: ProductionScheduleLeaderboardBoardResponse,
  appendOverride: ProductionScheduleLeaderboardBoardResponse | null
): ProductionScheduleLeaderboardBoardResponse {
  if (
    appendOverride != null &&
    appendOverride.rows.length >= shell.rows.length &&
    (appendOverride.resources.some((r) => r.hasMore) || appendOverride.residualSummaryDeferred === true)
  ) {
    return appendOverride;
  }
  return shell;
}
