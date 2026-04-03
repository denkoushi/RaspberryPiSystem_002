import { beforeEach, describe, expect, it, vi } from 'vitest';

import { PRODUCTION_SCHEDULE_ORDER_SUPPLEMENT_DASHBOARD_ID } from '../../production-schedule/constants.js';
import { CsvDashboardPostIngestService } from '../csv-dashboard-post-ingest.service.js';

const syncFromSupplementDashboard = vi.fn();

vi.mock('../../production-schedule/order-supplement-sync.service.js', () => ({
  ProductionScheduleOrderSupplementSyncService: vi.fn().mockImplementation(() => ({
    syncFromSupplementDashboard,
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
  });

  it('runs order supplement sync only for the supplement dashboard id', async () => {
    const svc = new CsvDashboardPostIngestService();
    const other = await svc.runAfterSuccessfulIngest({
      dashboardId: '00000000-0000-0000-0000-000000000001',
      ingestSource: 'manual',
    });
    expect(other.orderSupplementSync).toBeNull();
    expect(syncFromSupplementDashboard).not.toHaveBeenCalled();

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
    expect(syncFromSupplementDashboard).toHaveBeenCalledTimes(1);
  });
});
