import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  decorateLeaderboardCompositeBoardContinue,
  decorateLeaderboardCompositeBoardShell
} from '../leaderboard-composite-board-decoration.service.js';
import {
  decorateLeaderboardShellRowsForKiosk,
  decorateLeaderboardShellRowsForKioskFromHydratedRows
} from '../../production-schedule-query.service.js';
import { fetchLeaderboardScheduleHydratedRowsOrderedByDisplayItemIds } from '../leaderboard-split-expansion.service.js';
import { buildLeaderboardFooterChipsByPartKeyForScheduleRows } from '../leaderboard-part-footer-processes.service.js';
import { enrichProductionScheduleRowsWithResolvedMachineName } from '../../production-schedule-machine-name-enrichment.service.js';
import { enrichProductionScheduleRowsWithCustomerName } from '../../production-schedule-customer-name-enrichment.service.js';

vi.mock('../../production-schedule-query.service.js', () => ({
  decorateLeaderboardShellRowsForKiosk: vi.fn(),
  decorateLeaderboardShellRowsForKioskFromHydratedRows: vi.fn()
}));

vi.mock('../leaderboard-split-expansion.service.js', () => ({
  fetchLeaderboardScheduleHydratedRowsOrderedByDisplayItemIds: vi.fn()
}));

vi.mock('../leaderboard-part-footer-processes.service.js', () => ({
  buildLeaderboardFooterChipsByPartKeyForScheduleRows: vi.fn()
}));

vi.mock('../../production-schedule-machine-name-enrichment.service.js', () => ({
  enrichProductionScheduleRowsWithResolvedMachineName: vi.fn()
}));

vi.mock('../../production-schedule-customer-name-enrichment.service.js', () => ({
  enrichProductionScheduleRowsWithCustomerName: vi.fn()
}));

vi.mock('../../row-resolver/index.js', () => ({
  resolveLeaderboardMaterializedBaseWhere: vi.fn(async () => ({}))
}));

type LightRow = {
  id: string;
  rowData: Record<string, unknown>;
  resolvedMachineName: string | null;
  customerName: string | null;
};

function lightRow(id: string): LightRow {
  return {
    id,
    rowData: { FSIGENCD: 'R1', ProductNo: id },
    resolvedMachineName: null,
    customerName: null
  };
}

describe('decorateLeaderboardCompositeBoardShell', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('decorateLeaderboardShellRowsForKiosk の結果を merged 行へ合成する', async () => {
    const merged = [lightRow('a'), lightRow('b')];
    vi.mocked(decorateLeaderboardShellRowsForKiosk).mockResolvedValue({
      rowDecorations: [
        { id: 'a', resolvedMachineName: 'M-a', customerName: 'C-a' },
        { id: 'b', resolvedMachineName: null, customerName: null }
      ],
      leaderboardFooterChipsByPartKey: { 'k\0a': [] }
    });

    const result = await decorateLeaderboardCompositeBoardShell({
      mergedLightRows: merged,
      locationKey: 'kiosk-1'
    });

    expect(decorateLeaderboardShellRowsForKiosk).toHaveBeenCalledWith({
      orderedRowIds: ['a', 'b'],
      locationKey: 'kiosk-1',
      siteKey: undefined
    });
    expect(result.rowsWithDeco[0]?.resolvedMachineName).toBe('M-a');
    expect(result.rowsWithDeco[0]?.customerName).toBe('C-a');
    expect(result.leaderboardFooterChipsByPartKey).toEqual({ 'k\0a': [] });
  });
});

describe('decorateLeaderboardCompositeBoardContinue', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(buildLeaderboardFooterChipsByPartKeyForScheduleRows).mockResolvedValue({ 'part\0x': [] });
    vi.mocked(enrichProductionScheduleRowsWithResolvedMachineName).mockImplementation(async (rows) =>
      rows.map((row) => ({
        ...row,
        resolvedMachineName: `M-${(row as { id: string }).id}`
      }))
    );
    vi.mocked(enrichProductionScheduleRowsWithCustomerName).mockImplementation(async (rows) =>
      rows.map((row) => ({
        ...row,
        customerName: `C-${(row as { id: string }).id}`
      }))
    );
  });

  it('canAttachDelta 時は増分行のみ FromHydratedRows、prefix は hydrate+enrich、フッタは merged light', async () => {
    const merged = [lightRow('p1'), lightRow('p2'), lightRow('i1')];
    const incremental = [lightRow('i1')];

    vi.mocked(decorateLeaderboardShellRowsForKioskFromHydratedRows).mockResolvedValue({
      rowDecorations: [{ id: 'i1', resolvedMachineName: 'M-i1', customerName: 'C-i1' }],
      leaderboardFooterChipsByPartKey: {}
    });

    vi.mocked(fetchLeaderboardScheduleHydratedRowsOrderedByDisplayItemIds).mockResolvedValue([
      { id: 'p1', rowData: { ProductNo: 'p1' }, actualPerPieceMinutes: null, customerName: null },
      { id: 'p2', rowData: { ProductNo: 'p2' }, actualPerPieceMinutes: null, customerName: null }
    ] as never);

    const result = await decorateLeaderboardCompositeBoardContinue({
      mergedLightRows: merged,
      incrementalLightRows: incremental,
      canAttachDelta: true,
      deltaShellRowsFlattened: incremental,
      locationKey: 'kiosk-1'
    });

    expect(decorateLeaderboardShellRowsForKioskFromHydratedRows).toHaveBeenCalledTimes(1);
    expect(decorateLeaderboardShellRowsForKioskFromHydratedRows).toHaveBeenCalledWith(
      expect.objectContaining({ hydratedRows: incremental })
    );
    expect(fetchLeaderboardScheduleHydratedRowsOrderedByDisplayItemIds).toHaveBeenCalledWith(
      expect.objectContaining({ orderedDisplayItemIds: ['p1', 'p2'] })
    );
    expect(buildLeaderboardFooterChipsByPartKeyForScheduleRows).toHaveBeenCalledWith(
      expect.objectContaining({ rows: merged })
    );
    expect(enrichProductionScheduleRowsWithResolvedMachineName).toHaveBeenCalled();
    expect(result.rowsWithDeco.find((r) => r.id === 'i1')?.resolvedMachineName).toBe('M-i1');
    expect(result.rowsWithDeco.find((r) => r.id === 'p1')?.resolvedMachineName).toBe('M-p1');
    expect(result.deltaRowsWithDeco).toHaveLength(1);
  });

  it('canAttachDelta が false のとき累積全行を一括装飾する', async () => {
    const merged = [lightRow('a'), lightRow('b')];
    vi.mocked(decorateLeaderboardShellRowsForKioskFromHydratedRows).mockResolvedValue({
      rowDecorations: [
        { id: 'a', resolvedMachineName: 'M-a', customerName: null },
        { id: 'b', resolvedMachineName: null, customerName: null }
      ],
      leaderboardFooterChipsByPartKey: {}
    });

    await decorateLeaderboardCompositeBoardContinue({
      mergedLightRows: merged,
      incrementalLightRows: [],
      canAttachDelta: false,
      deltaShellRowsFlattened: [],
      locationKey: 'kiosk-1'
    });

    expect(decorateLeaderboardShellRowsForKioskFromHydratedRows).toHaveBeenCalledWith(
      expect.objectContaining({ hydratedRows: merged })
    );
    expect(fetchLeaderboardScheduleHydratedRowsOrderedByDisplayItemIds).not.toHaveBeenCalled();
    expect(buildLeaderboardFooterChipsByPartKeyForScheduleRows).not.toHaveBeenCalled();
  });
});
