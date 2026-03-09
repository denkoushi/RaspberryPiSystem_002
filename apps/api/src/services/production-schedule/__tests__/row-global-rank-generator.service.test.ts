import { beforeEach, describe, expect, it, vi } from 'vitest';

import { regenerateProductionScheduleGlobalRowRank } from '../row-global-rank-generator.service.js';
import {
  listGlobalRowRankPartPriorities,
  listGlobalRowRankTargets,
  listGlobalSeibanRankSeeds,
  replaceGlobalRowRanks,
} from '../row-global-rank.repository.js';

vi.mock('../row-global-rank.repository.js', () => ({
  listGlobalSeibanRankSeeds: vi.fn(),
  listGlobalRowRankTargets: vi.fn(),
  listGlobalRowRankPartPriorities: vi.fn(),
  replaceGlobalRowRanks: vi.fn(),
}));

describe('row-global-rank-generator.service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('製番順位 -> 部品優先 -> 工順 の順で行単位順位を生成する', async () => {
    vi.mocked(listGlobalSeibanRankSeeds).mockResolvedValue([
      { fseiban: 'A', priorityOrder: 1 },
      { fseiban: 'B', priorityOrder: 2 },
    ]);
    vi.mocked(listGlobalRowRankTargets).mockResolvedValue([
      { csvDashboardRowId: 'row-b-1', fseiban: 'B', fhincd: 'P3', fkojun: '1', productNo: '10', isCompleted: false },
      { csvDashboardRowId: 'row-a-x', fseiban: 'A', fhincd: 'X', fkojun: '10', productNo: '2', isCompleted: false },
      { csvDashboardRowId: 'row-a-y', fseiban: 'A', fhincd: 'Y', fkojun: '20', productNo: '1', isCompleted: true },
    ]);
    vi.mocked(listGlobalRowRankPartPriorities).mockResolvedValue([
      { fseiban: 'A', fhincd: 'Y', priorityRank: 1 },
      { fseiban: 'A', fhincd: 'X', priorityRank: 2 },
    ]);

    const result = await regenerateProductionScheduleGlobalRowRank({
      locationKey: 'kiosk-1',
      sourceType: 'manual',
    });

    expect(result).toEqual({
      generatedCount: 3,
      rankedFseibanCount: 2,
    });
    expect(replaceGlobalRowRanks).toHaveBeenCalledWith({
      locationKey: 'kiosk-1',
      sourceType: 'manual',
      rankedRows: [
        { csvDashboardRowId: 'row-a-y', fseiban: 'A', globalRank: 1 },
        { csvDashboardRowId: 'row-a-x', fseiban: 'A', globalRank: 2 },
        { csvDashboardRowId: 'row-b-1', fseiban: 'B', globalRank: 3 },
      ],
    });
  });

  it('製番順位が空ならスナップショットを空で保存する', async () => {
    vi.mocked(listGlobalSeibanRankSeeds).mockResolvedValue([]);

    const result = await regenerateProductionScheduleGlobalRowRank({
      locationKey: 'kiosk-1',
      sourceType: 'auto',
    });

    expect(result).toEqual({
      generatedCount: 0,
      rankedFseibanCount: 0,
    });
    expect(replaceGlobalRowRanks).toHaveBeenCalledWith({
      locationKey: 'kiosk-1',
      sourceType: 'auto',
      rankedRows: [],
    });
  });
});
