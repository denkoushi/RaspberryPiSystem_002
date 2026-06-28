import { beforeEach, describe, expect, it, vi } from 'vitest';

import { fetchLeaderboardBoardLaborMetadata } from '../leaderboard-labor-metadata.service.js';
import { attachLeaderboardLaborMinutes } from '../leaderboard-labor-minutes.service.js';
import { materializeProcessChangeResidualStrongEvidence } from '../leaderboard-process-change-residual.materialization.js';
import { readLeaderboardShellSnapshotGenerationTokenDetails } from '../leaderboard-shell-snapshot-generation.js';
import { fetchLeaderboardScheduleHydratedRowsOrderedByDisplayItemIds } from '../leaderboard-split-expansion.service.js';
import { resolveLeaderboardMaterializedBaseWhere } from '../../row-resolver/index.js';

import type { ProductionScheduleRow } from '../../production-schedule-query.service.js';

vi.mock('../../../../lib/prisma.js', () => ({
  prisma: { __mockPrisma: true }
}));

vi.mock('../../row-resolver/index.js', () => ({
  resolveLeaderboardMaterializedBaseWhere: vi.fn()
}));

vi.mock('../leaderboard-shell-snapshot-generation.js', () => ({
  readLeaderboardShellSnapshotGenerationTokenDetails: vi.fn()
}));

vi.mock('../leaderboard-process-change-residual.materialization.js', () => ({
  materializeProcessChangeResidualStrongEvidence: vi.fn()
}));

vi.mock('../leaderboard-split-expansion.service.js', () => ({
  fetchLeaderboardScheduleHydratedRowsOrderedByDisplayItemIds: vi.fn()
}));

vi.mock('../leaderboard-labor-minutes.service.js', () => ({
  attachLeaderboardLaborMinutes: vi.fn()
}));

function scheduleRow(id: string, machine?: number, labor?: number): ProductionScheduleRow {
  return {
    id,
    seibanJoinKey: null,
    occurredAt: new Date('2026-01-01T00:00:00.000Z'),
    rowData: { ProductNo: id, FSIGENCD: 'R1', FKOJUN: '10' },
    processingOrder: null,
    globalRank: null,
    actualPerPieceMinutes: null,
    note: null,
    processingType: null,
    dueDate: null,
    plannedQuantity: null,
    plannedStartDate: null,
    plannedEndDate: null,
    customerName: null,
    ...(machine != null ? { machineRequiredMinutes: machine } : {}),
    ...(labor != null ? { laborRequiredMinutes: labor } : {})
  };
}

describe('fetchLeaderboardBoardLaborMetadata', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(readLeaderboardShellSnapshotGenerationTokenDetails).mockResolvedValue({
      generationToken: 'gen-1',
      fkojunstStatusMailRowsRevision: 'rev-1'
    });
    vi.mocked(materializeProcessChangeResidualStrongEvidence).mockResolvedValue({
      keys: new Set(['residual-key']),
      keyArrays: {
        productNos: ['P1'],
        fkojuns: ['10'],
        resourceCds: ['R1']
      },
      evidenceByKey: new Map(),
      rawMailRowsRevision: 'rev-1'
    });
    vi.mocked(resolveLeaderboardMaterializedBaseWhere).mockResolvedValue({ marker: 'where' } as never);
  });

  it('表示 row id だけ hydrate し attachLabor の結果から metadata を返す', async () => {
    const hydrated = [scheduleRow('known')];
    const attached = [scheduleRow('known', 400, 175)];
    vi.mocked(fetchLeaderboardScheduleHydratedRowsOrderedByDisplayItemIds).mockResolvedValue(hydrated);
    vi.mocked(attachLeaderboardLaborMinutes).mockResolvedValue(attached);
    const perf = vi.fn();

    const result = await fetchLeaderboardBoardLaborMetadata(
      {
        orderedRowIds: ['known', 'missing', 'known'],
        locationKey: 'device-a',
        siteKey: 'site-a'
      },
      { performanceSink: perf }
    );

    expect(fetchLeaderboardScheduleHydratedRowsOrderedByDisplayItemIds).toHaveBeenCalledTimes(1);
    expect(fetchLeaderboardScheduleHydratedRowsOrderedByDisplayItemIds).toHaveBeenCalledWith(
      expect.objectContaining({
        orderedDisplayItemIds: ['known', 'missing'],
        locationKey: 'device-a',
        siteScopedGlobalRankLocation: 'site-a',
        leaderboardMaterializedBaseWhere: { marker: 'where' }
      })
    );
    expect(attachLeaderboardLaborMinutes).toHaveBeenCalledTimes(1);
    expect(attachLeaderboardLaborMinutes).toHaveBeenCalledWith(
      hydrated,
      expect.objectContaining({
        leaderboardMaterializedBaseWhere: { marker: 'where' },
        processChangeResidualMode: 'normal',
        processChangeResidualStrongEvidenceKeys: new Set(['residual-key']),
        cacheScopeKey: 'gen-1'
      })
    );
    expect(result).toEqual({
      rowMetadata: [{ id: 'known', machineRequiredMinutes: 400, laborRequiredMinutes: 175 }]
    });
    expect(perf.mock.calls.map(([event]) => event.phase)).toEqual([
      'materializedBaseWhere',
      'hydrateRows',
      'attachLabor',
      'requestTotal'
    ]);
    expect(perf.mock.calls.every(([event]) => event.endpoint === 'laborMetadata')).toBe(true);
  });

  it('metadata 数値が揃わない hydrate 結果は応答から omit する', async () => {
    vi.mocked(fetchLeaderboardScheduleHydratedRowsOrderedByDisplayItemIds).mockResolvedValue([
      scheduleRow('known'),
      scheduleRow('complete', 10, 5)
    ]);
    vi.mocked(attachLeaderboardLaborMinutes).mockResolvedValue([
      scheduleRow('known'),
      scheduleRow('complete', 10, 5)
    ]);

    const result = await fetchLeaderboardBoardLaborMetadata({
      orderedRowIds: ['known', 'complete'],
      locationKey: 'device-a'
    });

    expect(result.rowMetadata).toEqual([
      { id: 'complete', machineRequiredMinutes: 10, laborRequiredMinutes: 5 }
    ]);
  });
});
