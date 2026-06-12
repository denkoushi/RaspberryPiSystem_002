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
  if (fingerprintLeaderboardBoardShellScope(appendOverride) !== fingerprintLeaderboardBoardShellScope(shell)) {
    return shell;
  }
  return appendOverride.rows.length >= shell.rows.length ? appendOverride : shell;
}

function fingerprintLeaderboardBoardShellScope(board: ProductionScheduleLeaderboardBoardResponse): string {
  const resources = board.resources
    .map((r) => `${r.resourceCd}:${r.total}:${r.pageSize}`)
    .join('\u0002');
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
    board.total,
    board.processChangeResidualTotal ?? 0,
    board.processChangeResidualRepresentativeLimit ?? '',
    residualRows
  ].join('\u0002');
  return `${resources}\u0003${residual}`;
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
