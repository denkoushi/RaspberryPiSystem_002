import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  PRODUCTION_SCHEDULE_DASHBOARD_ID,
  PRODUCTION_SCHEDULE_ORDER_SUPPLEMENT_DASHBOARD_ID,
  PRODUCTION_SCHEDULE_FKOBAINO_DASHBOARD_ID,
  PRODUCTION_SCHEDULE_FKOJUNST_STATUS_MAIL_DASHBOARD_ID,
} from '../../production-schedule/constants.js';
import { calculateDataHash } from '../csv-dashboard-row-normalizer.js';
import * as diffModule from '../diff/csv-dashboard-diff.js';

const mocks = vi.hoisted(() => ({
  dashboard: vi.fn(), createRun: vi.fn(), updateRun: vi.fn(), findRows: vi.fn(),
  createMany: vi.fn(), updateRow: vi.fn(), info: vi.fn(),
}));
vi.mock('../../../lib/logger.js', () => ({ logger: { info: mocks.info, error: vi.fn(), warn: vi.fn() } }));
vi.mock('../../../lib/prisma.js', () => ({ prisma: {
  csvDashboard: { findUnique: mocks.dashboard },
  csvDashboardIngestRun: { create: mocks.createRun, update: mocks.updateRun },
  csvDashboardRow: { findMany: mocks.findRows, createMany: mocks.createMany, update: mocks.updateRow },
  productionScheduleSessakuPieceSet: { findMany: vi.fn().mockResolvedValue([]) },
  $transaction: vi.fn(async (callback: (tx: unknown) => Promise<unknown>) => callback({
    csvDashboardIngestRun: { update: mocks.updateRun }, $queryRaw: vi.fn(), $executeRaw: vi.fn(),
  })),
} }));
vi.mock('../csv-dashboard-dedup-cleanup.service.js', () => ({ CsvDashboardDedupCleanupService: class {
  async deleteDuplicateLosersForKeys() { return { deletedCount: 0 }; }
} }));

import { CsvDashboardIngestor } from '../csv-dashboard-ingestor.js';

describe('CsvDashboardIngestor unchanged row refresh', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.dashboard.mockResolvedValue({ enabled: true, name: 'test', ingestMode: 'DEDUP', dateColumnName: null,
      dedupKeyColumns: ['key'], columnDefinitions: [
        { internalName: 'key', csvHeaderCandidates: ['key'], dataType: 'string' },
        { internalName: 'quantity', csvHeaderCandidates: ['quantity'], dataType: 'number' },
        { internalName: 'active', csvHeaderCandidates: ['active'], dataType: 'boolean' },
        { internalName: 'empty', csvHeaderCandidates: ['empty'], dataType: 'string' },
      ] });
    mocks.createRun.mockResolvedValue({ id: 'new-run', startedAt: new Date() });
    mocks.findRows.mockResolvedValue([]);
  });

  it.each([
    [PRODUCTION_SCHEDULE_ORDER_SUPPLEMENT_DASHBOARD_ID, true],
    [PRODUCTION_SCHEDULE_FKOBAINO_DASHBOARD_ID, true],
    [PRODUCTION_SCHEDULE_DASHBOARD_ID, false],
    [PRODUCTION_SCHEDULE_FKOJUNST_STATUS_MAIL_DASHBOARD_ID, false],
    ['other-dashboard', false],
  ])('enables the option only for target dashboards: %s', async (dashboardId, enabled) => {
    const spy = vi.spyOn(diffModule, 'computeCsvDashboardDedupDiff');
    try {
      await new CsvDashboardIngestor().ingestFromGmail(dashboardId as string, 'key,quantity,active,empty\n');
      expect(spy).toHaveBeenCalledTimes(1);
      expect(spy.mock.calls[0]?.[0].options?.skipUnchangedRowsWithinRefreshWindow === true).toBe(enabled);
    } finally { spy.mockRestore(); }
  });

  it.each([PRODUCTION_SCHEDULE_ORDER_SUPPLEMENT_DASHBOARD_ID, PRODUCTION_SCHEDULE_FKOBAINO_DASHBOARD_ID])(
    'matches actual normalized CSV values against reordered DB JSON and logs zero writes: %s', async (dashboardId) => {
      // DB jsonb values, with the keys in a different order from the CSV normalizer.
      const rowData = { empty: '', active: true, quantity: 12, key: 'A' };
      mocks.findRows.mockResolvedValue([{ id: 'existing', dataHash: calculateDataHash(rowData, ['key']),
        rowData, occurredAt: new Date(Date.now() - 86_400_000), sourceIngestRunId: 'completed-run',
        sourceIngestRun: { status: 'COMPLETED', completedAt: new Date() } }]);
      await expect(new CsvDashboardIngestor().ingestFromGmail(dashboardId, 'key,quantity,active,empty\n A ,12,yes,\n'))
        .resolves.toMatchObject({ rowsProcessed: 1, rowsAdded: 0, rowsSkipped: 1 });
      expect(mocks.createMany).not.toHaveBeenCalled();
      expect(mocks.updateRow).not.toHaveBeenCalled();
      expect(mocks.updateRun).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: 'COMPLETED', rowsAdded: 0 }) }));
      expect(mocks.info).toHaveBeenCalledWith(expect.objectContaining({ dashboardId,
        rowsCreated: 0, rowsUpdated: 0, rowsSkippedUnchanged: 1 }), '[CsvDashboardIngestor] CSV ingestion completed');
    }
  );
});
