import type { LeaderboardShellPhasedReadResult } from '../production-schedule-query.service.js';

/**
 * shell 完了後のスロット別 total。
 * prefix で全件確定（`hasMore=false`）のときは COUNT 不要で `rows.length` が正本（件数定義は monolithic と同値）。
 */
export function resolveLeaderboardBoardShellResourceTotalFromShell(
  shell: Pick<LeaderboardShellPhasedReadResult, 'rows' | 'hasMore'>
): number | undefined {
  if (shell.hasMore === false) {
    return shell.rows.length;
  }
  return undefined;
}
