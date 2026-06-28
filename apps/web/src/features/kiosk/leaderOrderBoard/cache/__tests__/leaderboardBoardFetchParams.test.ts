import { describe, expect, it } from 'vitest';

import {
  buildLeaderboardBoardBaseFetchParams,
  buildLeaderboardBoardLegacyFetchParams,
  buildLeaderboardBoardReconcileFetchParams,
  buildLeaderboardSeibanOrQueryText
} from '../leaderboardBoardFetchParams';

describe('leaderboardBoardFetchParams', () => {
  it('buildLeaderboardSeibanOrQueryText', () => {
    expect(buildLeaderboardSeibanOrQueryText([])).toBeUndefined();
    expect(buildLeaderboardSeibanOrQueryText([' AA1 ', 'BB2', 'AA1'])).toBe('AA1,BB2');
  });

  it('base は q を除き light shell policy を付与', () => {
    const base = buildLeaderboardBoardBaseFetchParams({
      phasedBase: {
        allowResourceOnly: true,
        pageSize: 80,
        q: 'OLD',
        includeLabor: false,
        completionFilter: 'incomplete'
      },
      boardResourceCds: ['R1', 'R2']
    });
    expect(base.q).toBeUndefined();
    expect(base.boardResourceCds).toBe('R1,R2');
    expect(base.completionFilter).toBe('incomplete');
    expect(base.includeDecorations).toBe(false);
    expect(base.includeLabor).toBe(false);
    expect(base.deferTotals).toBe(true);
  });

  it('reconcile は q と light shell policy を付与', () => {
    const reconcile = buildLeaderboardBoardReconcileFetchParams({
      phasedBase: { allowResourceOnly: true, pageSize: 80 },
      boardResourceCds: ['R1'],
      seibanOrFilters: ['AA111111', 'BB222222']
    });
    expect(reconcile?.q).toBe('AA111111,BB222222');
    expect(reconcile?.includeDecorations).toBe(false);
    expect(reconcile?.deferTotals).toBe(true);
  });

  it('legacy は q と light shell policy を付与', () => {
    const legacy = buildLeaderboardBoardLegacyFetchParams({
      phasedBase: { allowResourceOnly: true, pageSize: 80 },
      boardResourceCds: ['R1'],
      seibanOrFilters: ['AA111111']
    });
    expect(legacy.q).toBe('AA111111');
    expect(legacy.includeDecorations).toBe(false);
    expect(legacy.deferTotals).toBe(true);
  });
});
