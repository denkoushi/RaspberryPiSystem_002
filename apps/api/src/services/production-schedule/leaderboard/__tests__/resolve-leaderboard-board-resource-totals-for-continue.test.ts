import { afterEach, describe, expect, it, vi } from 'vitest';

import * as queryService from '../../production-schedule-query.service.js';
import {
  clearLeaderboardBoardSnapshotResourceTotalsForTests,
  seedLeaderboardBoardSnapshotResourceTotal
} from '../leaderboard-composite-board-snapshot-totals.js';
import { resolveLeaderboardBoardResourceTotalsForContinue } from '../resolve-leaderboard-board-resource-totals-for-continue.js';

describe('resolveLeaderboardBoardResourceTotalsForContinue', () => {
  afterEach(() => {
    clearLeaderboardBoardSnapshotResourceTotalsForTests();
    vi.restoreAllMocks();
  });

  const listParamsBase = {
    queryText: '',
    productNos: [] as string[],
    machineName: undefined,
    assignedOnlyCds: [] as string[],
    resourceCategory: undefined,
    hasNoteOnly: false,
    hasDueDateOnly: false,
    allowResourceOnly: true,
    locationKey: 'loc-a',
    siteKey: 'site-a'
  };

  it('uses cached snapshot totals without COUNT when seeded', async () => {
    seedLeaderboardBoardSnapshotResourceTotal('aaaaaaaa-bbbb-cccc-dddd-aaaaaaaaaaaa', 100);
    seedLeaderboardBoardSnapshotResourceTotal('aaaaaaaa-bbbb-cccc-dddd-bbbbbbbbbbbb', 200);

    const countSpy = vi.spyOn(queryService, 'countProductionScheduleDashboardVisibleRowsFromListFilters');

    const totals = await resolveLeaderboardBoardResourceTotalsForContinue(listParamsBase, [
      { resourceCd: '1', snapshotId: 'aaaaaaaa-bbbb-cccc-dddd-aaaaaaaaaaaa' },
      { resourceCd: '2', snapshotId: 'aaaaaaaa-bbbb-cccc-dddd-bbbbbbbbbbbb' }
    ]);

    expect(totals).toEqual([100, 200]);
    expect(countSpy).not.toHaveBeenCalled();
  });

  it('falls back to COUNT when snapshot total is missing', async () => {
    const countSpy = vi
      .spyOn(queryService, 'countProductionScheduleDashboardVisibleRowsFromListFilters')
      .mockResolvedValueOnce(55)
      .mockResolvedValueOnce(66);

    const totals = await resolveLeaderboardBoardResourceTotalsForContinue(listParamsBase, [
      { resourceCd: '1', snapshotId: 'aaaaaaaa-bbbb-cccc-dddd-cccccccccccc' },
      { resourceCd: '2' }
    ]);

    expect(totals).toEqual([55, 66]);
    expect(countSpy).toHaveBeenCalledTimes(2);
  });
});
