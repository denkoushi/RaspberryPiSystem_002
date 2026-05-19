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
  return appendOverride.rows.length >= shell.rows.length ? appendOverride : shell;
}

/**
 * shell + 追補状態の指紋。参照が変わっても内容が同じなら追補ループを再開しない。
 */
export function fingerprintLeaderboardBoardShell(
  board: ProductionScheduleLeaderboardBoardResponse | undefined
): string {
  if (!board) return '';
  const rowIds = board.rows.map((r) => r.id).join('\u0001');
  const resources = board.resources
    .map((r) => `${r.resourceCd}:${r.hasMore}:${r.nextCursor ?? ''}:${r.snapshotId ?? ''}`)
    .join('\u0002');
  return `${rowIds}\u0003${resources}`;
}

/** scheduleQuery 用: 行データがある限り初回ローディング扱いにしない */
export function isLeaderboardScheduleInitialLoading(
  boardQueryLoading: boolean,
  displayRowCount: number
): boolean {
  return boardQueryLoading && displayRowCount === 0;
}
