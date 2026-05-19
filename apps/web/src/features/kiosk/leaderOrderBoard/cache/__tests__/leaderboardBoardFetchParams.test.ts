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

  it('base は q を除く', () => {
    const base = buildLeaderboardBoardBaseFetchParams({
      phasedBase: { allowResourceOnly: true, pageSize: 80, q: 'OLD' },
      boardResourceCds: ['R1', 'R2']
    });
    expect(base.q).toBeUndefined();
    expect(base.boardResourceCds).toBe('R1,R2');
    expect(base.includeDecorations).toBe(false);
  });

  it('reconcile は q を付与', () => {
    const reconcile = buildLeaderboardBoardReconcileFetchParams({
      phasedBase: { allowResourceOnly: true, pageSize: 80 },
      boardResourceCds: ['R1'],
      seibanOrFilters: ['AA111111', 'BB222222']
    });
    expect(reconcile?.q).toBe('AA111111,BB222222');
  });

  it('legacy は q を付与', () => {
    const legacy = buildLeaderboardBoardLegacyFetchParams({
      phasedBase: { allowResourceOnly: true, pageSize: 80 },
      boardResourceCds: ['R1'],
      seibanOrFilters: ['AA111111']
    });
    expect(legacy.q).toBe('AA111111');
  });
});
