import type { LeaderBoardRow } from './types';

export type LeaderOrderCompletionFilter = 'all' | 'complete' | 'incomplete';

export function filterLeaderBoardRowsByCompletion(
  rows: readonly LeaderBoardRow[],
  filter: LeaderOrderCompletionFilter
): LeaderBoardRow[] {
  if (filter === 'all') return [...rows];
  if (filter === 'complete') return rows.filter((r) => r.isCompleted);
  return rows.filter((r) => !r.isCompleted);
}
