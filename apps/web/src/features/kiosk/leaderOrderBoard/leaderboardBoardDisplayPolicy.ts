import type { ProductionScheduleLeaderboardBoardResponse } from '../../../api/client';

/**
 * 画面表示に採用する board を選ぶ。
 * 同一 params での refetch 時、追補済み行数が shell より多い場合は追補結果を維持する（巻き戻し防止）。
 */
export function pickLeaderboardBoardForDisplay(
  shell: ProductionScheduleLeaderboardBoardResponse | undefined,
  appendOverride: ProductionScheduleLeaderboardBoardResponse | null
): ProductionScheduleLeaderboardBoardResponse | undefined {
  if (!appendOverride) return shell;
  if (!shell) return appendOverride;
  if (!isSameLeaderboardBoardShellScope(appendOverride, shell)) {
    return shell;
  }
  return appendOverride.rows.length >= shell.rows.length ? appendOverride : shell;
}

function isSameLeaderboardBoardShellScope(
  a: ProductionScheduleLeaderboardBoardResponse,
  b: ProductionScheduleLeaderboardBoardResponse
): boolean {
  const ignoreResourceTotals = a.totalsDeferred === true || b.totalsDeferred === true;
  return (
    fingerprintLeaderboardBoardShellScope(a, { ignoreResourceTotals }) ===
    fingerprintLeaderboardBoardShellScope(b, { ignoreResourceTotals })
  );
}

function fingerprintLeaderboardBoardShellScope(
  board: ProductionScheduleLeaderboardBoardResponse,
  options?: { ignoreResourceTotals?: boolean }
): string {
  const resources = fingerprintLeaderboardBoardResourcePagingScope(board, options);
  const residualRows = (board.processChangeResidualRows ?? [])
    .map((row) => {
      const evidence = row.processChangeResidualEvidence;
      if (!evidence) {
        return row.id;
      }
      return `${row.id}:${evidence.current.productNo}:${evidence.current.fkojun}:${evidence.current.resourceCd}:${evidence.current.status}:${evidence.current.fupdtedt ?? ''}:${evidence.completedOtherResource.productNo}:${evidence.completedOtherResource.fkojun}:${evidence.completedOtherResource.resourceCd}:${evidence.completedOtherResource.status}:${evidence.completedOtherResource.fupdtedt ?? ''}`;
    })
    .sort()
    .join('\u0001');
  const residual = [
    options?.ignoreResourceTotals === true ? '*' : board.total,
    board.residualSummaryDeferred === true ? 'pending' : 'resolved',
    board.processChangeResidualTotal ?? 0,
    board.processChangeResidualRepresentativeLimit ?? '',
    residualRows
  ].join('\u0002');
  return `${resources}\u0003${residual}`;
}

function fingerprintLeaderboardBoardResourcePagingScope(
  board: ProductionScheduleLeaderboardBoardResponse,
  options?: { ignoreResourceTotals?: boolean }
): string {
  return board.resources
    .map((r) => `${r.resourceCd}:${options?.ignoreResourceTotals === true ? '*' : r.total}`)
    .join('\u0002');
}

/**
 * shell + 追補状態の指紋。参照が変わっても内容が同じなら追補ループを再開しない。
 */
export function fingerprintLeaderboardBoardShell(
  board: ProductionScheduleLeaderboardBoardResponse | undefined
): string {
  if (!board) return '';
  const rowIds = board.rows.map((r) => r.id).join('\u0001');
  const volatileSnapshotState = board.resources
    .map((r) => `${r.resourceCd}:${r.snapshotId ?? ''}:${r.hasMore ? 1 : 0}:${r.nextCursor ?? ''}`)
    .join('\u0002');
  return `${rowIds}\u0003${fingerprintLeaderboardBoardShellScope(board)}\u0003${volatileSnapshotState}`;
}

/** scheduleQuery 用: 行データがある限り初回ローディング扱いにしない */
export function isLeaderboardScheduleInitialLoading(
  boardQueryLoading: boolean,
  displayRowCount: number
): boolean {
  return boardQueryLoading && displayRowCount === 0;
}

/** 資源スライスに未到達ページが残っているか */
export function isLeaderboardBoardResourcePagingIncomplete(
  board: ProductionScheduleLeaderboardBoardResponse
): boolean {
  return board.resources.some(
    (r) => r.hasMore || (typeof r.nextCursor === 'number' && r.nextCursor < r.total)
  );
}

export function isLeaderboardBoardPagingComplete(
  board: ProductionScheduleLeaderboardBoardResponse | undefined
): boolean {
  if (!board) return false;
  return !isLeaderboardBoardResourcePagingIncomplete(board);
}

/**
 * ネットワーク採用 board のページング完走判定。
 * 表示採用が fresh shell に戻って未完に見えても、同一 params の追補 override が完走済みなら true。
 */
export function resolveNetworkLeaderboardBoardPagingComplete(input: {
  networkDisplayBoard: ProductionScheduleLeaderboardBoardResponse | undefined;
  scopedAppendOverride: ProductionScheduleLeaderboardBoardResponse | null;
  resolvedShell: ProductionScheduleLeaderboardBoardResponse | undefined;
}): boolean {
  if (isLeaderboardBoardPagingComplete(input.networkDisplayBoard)) return true;
  const override = input.scopedAppendOverride;
  const shell = input.resolvedShell;
  if (
    override != null &&
    shell != null &&
    fingerprintLeaderboardBoardResourcePagingScope(override, {
      ignoreResourceTotals: override.totalsDeferred === true || shell.totalsDeferred === true
    }) ===
      fingerprintLeaderboardBoardResourcePagingScope(shell, {
        ignoreResourceTotals: override.totalsDeferred === true || shell.totalsDeferred === true
      }) &&
    override.rows.length >= shell.rows.length &&
    isLeaderboardBoardPagingComplete(override)
  ) {
    return true;
  }
  return false;
}
