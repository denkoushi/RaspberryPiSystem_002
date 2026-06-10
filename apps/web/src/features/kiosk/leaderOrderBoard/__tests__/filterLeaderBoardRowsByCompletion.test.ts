import { describe, expect, it } from 'vitest';

import { filterLeaderBoardRowsByCompletion } from '../filterLeaderBoardRowsByCompletion';

import { mkLeaderBoardRow } from './leaderBoardRowTestFixtures';

import type { LeaderBoardRow } from '../types';

const r = (id: string, isCompleted: boolean): LeaderBoardRow => mkLeaderBoardRow({ id, isCompleted });

describe('filterLeaderBoardRowsByCompletion', () => {
  it('filters complete and incomplete', () => {
    const rows = [r('a', false), r('b', true), r('c', false)];
    expect(filterLeaderBoardRowsByCompletion(rows, 'all').map((x) => x.id)).toEqual(['a', 'b', 'c']);
    expect(filterLeaderBoardRowsByCompletion(rows, 'complete').map((x) => x.id)).toEqual(['b']);
    expect(filterLeaderBoardRowsByCompletion(rows, 'incomplete').map((x) => x.id)).toEqual(['a', 'c']);
  });
});
