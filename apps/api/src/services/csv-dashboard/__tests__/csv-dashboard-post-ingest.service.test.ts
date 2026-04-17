import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  PRODUCTION_SCHEDULE_FKOJUNST_DASHBOARD_ID,
  PRODUCTION_SCHEDULE_ORDER_SUPPLEMENT_DASHBOARD_ID,
  PRODUCTION_SCHEDULE_SEIBAN_MACHINE_NAME_SUPPLEMENT_DASHBOARD_ID,
} from '../../production-schedule/constants.js';
import { CsvDashboardPostIngestService } from '../csv-dashboard-post-ingest.service.js';

const syncFromSupplementDashboard = vi.fn();
const syncFromFkojunstDashboard = vi.fn();
const syncFromSeibanMachineNameSupplementDashboard = vi.fn();

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

vi.mock('../../production-schedule/seiban-machine-name-supplement-sync.service.js', () => ({
  ProductionScheduleSeibanMachineNameSupplementSyncService: vi.fn().mockImplementation(() => ({
    syncFromSupplementDashboard: syncFromSeibanMachineNameSupplementDashboard,
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
    syncFromSeibanMachineNameSupplementDashboard.mockResolvedValue({
      scanned: 3,
      normalized: 2,
      upserted: 2,
      pruned: 1,
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
    expect(other.seibanMachineNameSupplementSync).toBeNull();
    expect(syncFromSupplementDashboard).not.toHaveBeenCalled();
    expect(syncFromFkojunstDashboard).not.toHaveBeenCalled();
    expect(syncFromSeibanMachineNameSupplementDashboard).not.toHaveBeenCalled();

    const hit = await svc.runAfterSuccessfulIngest({
      dashboardId: PRODUCTION_SCHEDULE_ORDER_SUPPLEMENT_DASHBOARD_ID,
      ingestSource: 'gmail',
      ingestRunId: 'run-order-supplement',
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
    expect(hit.seibanMachineNameSupplementSync).toBeNull();
    expect(syncFromSupplementDashboard).toHaveBeenCalledTimes(1);
    expect(syncFromFkojunstDashboard).not.toHaveBeenCalled();
    expect(syncFromSeibanMachineNameSupplementDashboard).not.toHaveBeenCalled();
  });

  it('runs FKOJUNST sync only for the FKOJUNST dashboard id', async () => {
    const svc = new CsvDashboardPostIngestService();
    const hit = await svc.runAfterSuccessfulIngest({
      dashboardId: PRODUCTION_SCHEDULE_FKOJUNST_DASHBOARD_ID,
      ingestSource: 'manual',
      ingestRunId: 'run-fkojunst',
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
    expect(hit.seibanMachineNameSupplementSync).toBeNull();
    expect(syncFromFkojunstDashboard).toHaveBeenCalledTimes(1);
    expect(syncFromSupplementDashboard).not.toHaveBeenCalled();
    expect(syncFromSeibanMachineNameSupplementDashboard).not.toHaveBeenCalled();
  });

  it('runs seiban machine name supplement sync only for the FHINMEI_MH_SH dashboard id', async () => {
    const svc = new CsvDashboardPostIngestService();
    const hit = await svc.runAfterSuccessfulIngest({
      dashboardId: PRODUCTION_SCHEDULE_SEIBAN_MACHINE_NAME_SUPPLEMENT_DASHBOARD_ID,
      ingestSource: 'gmail',
      ingestRunId: 'run-seiban-machine-name',
    });
    expect(hit.seibanMachineNameSupplementSync).toEqual({
      scanned: 3,
      normalized: 2,
      upserted: 2,
      pruned: 1,
    });
    expect(hit.orderSupplementSync).toBeNull();
    expect(hit.fkojunstSync).toBeNull();
    expect(syncFromSeibanMachineNameSupplementDashboard).toHaveBeenCalledTimes(1);
    expect(syncFromSeibanMachineNameSupplementDashboard).toHaveBeenCalledWith({
      ingestRunId: 'run-seiban-machine-name',
    });
    expect(syncFromSupplementDashboard).not.toHaveBeenCalled();
    expect(syncFromFkojunstDashboard).not.toHaveBeenCalled();
  });
});
