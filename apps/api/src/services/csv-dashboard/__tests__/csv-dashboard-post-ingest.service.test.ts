import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  PRODUCTION_SCHEDULE_FKOJUNST_DASHBOARD_ID,
  PRODUCTION_SCHEDULE_ORDER_SUPPLEMENT_DASHBOARD_ID,
} from '../../production-schedule/constants.js';
import { CsvDashboardPostIngestService } from '../csv-dashboard-post-ingest.service.js';

const syncFromSupplementDashboard = vi.fn();
const syncFromFkojunstDashboard = vi.fn();

vi.mock('../../production-schedule/order-supplement-sync.service.js', () => ({
  ProductionScheduleOrderSupplementSyncService: vi.fn().mockImplementation(() => ({
    syncFromSupplementDashboard,
  })),
}));

vi.mock('../../production-schedule/fkojunst-sync.service.js', () => ({
  ProductionScheduleFkojunstSyncService: vi.fn().mockImplementation(() => ({
    syncFromFkojunstDashboard,
  })),
}));

describe('CsvDashboardPostIngestService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    syncFromSupplementDashboard.mockResolvedValue({
      scanned: 2,
      normalized: 2,
      matched: 2,
      unmatched: 0,
      upserted: 2,
      pruned: 0,
    });
    syncFromFkojunstDashboard.mockResolvedValue({
      scanned: 1,
      normalized: 1,
      matched: 1,
      unmatched: 0,
      skippedInvalidStatus: 0,
      upserted: 1,
      pruned: 0,
    });
  });

  it('runs order supplement sync only for the supplement dashboard id', async () => {
    const svc = new CsvDashboardPostIngestService();
    const other = await svc.runAfterSuccessfulIngest({
      dashboardId: '00000000-0000-0000-0000-000000000001',
      ingestSource: 'manual',
    });
    expect(other.orderSupplementSync).toBeNull();
    expect(other.fkojunstSync).toBeNull();
    expect(syncFromSupplementDashboard).not.toHaveBeenCalled();
    expect(syncFromFkojunstDashboard).not.toHaveBeenCalled();

    const hit = await svc.runAfterSuccessfulIngest({
      dashboardId: PRODUCTION_SCHEDULE_ORDER_SUPPLEMENT_DASHBOARD_ID,
      ingestSource: 'gmail',
    });
    expect(hit.orderSupplementSync).toEqual({
      scanned: 2,
      normalized: 2,
      matched: 2,
      unmatched: 0,
      upserted: 2,
      pruned: 0,
    });
    expect(hit.fkojunstSync).toBeNull();
    expect(syncFromSupplementDashboard).toHaveBeenCalledTimes(1);
    expect(syncFromFkojunstDashboard).not.toHaveBeenCalled();
  });

  it('runs FKOJUNST sync only for the FKOJUNST dashboard id', async () => {
    const svc = new CsvDashboardPostIngestService();
    const hit = await svc.runAfterSuccessfulIngest({
      dashboardId: PRODUCTION_SCHEDULE_FKOJUNST_DASHBOARD_ID,
      ingestSource: 'manual',
    });
    expect(hit.fkojunstSync).toEqual({
      scanned: 1,
      normalized: 1,
      matched: 1,
      unmatched: 0,
      skippedInvalidStatus: 0,
      upserted: 1,
      pruned: 0,
    });
    expect(hit.orderSupplementSync).toBeNull();
    expect(syncFromFkojunstDashboard).toHaveBeenCalledTimes(1);
    expect(syncFromSupplementDashboard).not.toHaveBeenCalled();
  });
});
