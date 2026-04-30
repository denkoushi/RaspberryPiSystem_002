import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  PRODUCTION_SCHEDULE_CUSTOMER_SCAW_DASHBOARD_ID,
  PRODUCTION_SCHEDULE_FKOBAINO_DASHBOARD_ID,
  PRODUCTION_SCHEDULE_FKOJUNST_DASHBOARD_ID,
  PRODUCTION_SCHEDULE_FKOJUNST_STATUS_MAIL_DASHBOARD_ID,
  PRODUCTION_SCHEDULE_ORDER_SUPPLEMENT_DASHBOARD_ID,
  PRODUCTION_SCHEDULE_SEIBAN_MACHINE_NAME_SUPPLEMENT_DASHBOARD_ID,
} from '../../production-schedule/constants.js';
import { CsvDashboardPostIngestService } from '../csv-dashboard-post-ingest.service.js';

const syncFromSupplementDashboard = vi.fn();
const syncFromFkojunstDashboard = vi.fn();
const syncFromStatusMailDashboard = vi.fn();
const syncFromSeibanMachineNameSupplementDashboard = vi.fn();
const syncFromCustomerScawDashboard = vi.fn();
const syncFromFkobainoDashboard = vi.fn();

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

vi.mock('../../production-schedule/fkojunst-status-mail-sync.service.js', () => ({
  ProductionScheduleFkojunstMailStatusSyncService: vi.fn().mockImplementation(() => ({
    syncFromStatusMailDashboard,
  })),
}));

vi.mock('../../production-schedule/seiban-machine-name-supplement-sync.service.js', () => ({
  ProductionScheduleSeibanMachineNameSupplementSyncService: vi.fn().mockImplementation(() => ({
    syncFromSupplementDashboard: syncFromSeibanMachineNameSupplementDashboard,
  })),
}));

vi.mock('../../production-schedule/customer-scaw-sync.service.js', () => ({
  ProductionScheduleCustomerScawSyncService: vi.fn().mockImplementation(() => ({
    syncFromCustomerScawDashboard,
  })),
}));

vi.mock('../../purchase-order-lookup/purchase-order-lookup-sync.service.js', () => ({
  PurchaseOrderLookupSyncService: vi.fn().mockImplementation(() => ({
    syncFromFkobainoDashboard,
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
    syncFromStatusMailDashboard.mockResolvedValue({
      scanned: 2,
      normalized: 2,
      matched: 2,
      unmatched: 0,
      skippedInvalidStatus: 0,
      skippedUnparseableDate: 0,
      upserted: 2,
      pruned: 0,
    });
    syncFromSeibanMachineNameSupplementDashboard.mockResolvedValue({
      scanned: 3,
      normalized: 2,
      upserted: 2,
      pruned: 1,
    });
    syncFromFkobainoDashboard.mockResolvedValue({
      scanned: 4,
      inserted: 4,
      upserted: 4,
    });
    syncFromCustomerScawDashboard.mockResolvedValue({
      csvRowsScanned: 2,
      fankenmeiKeys: 1,
      productionRowsScanned: 3,
      matchedFseibans: 1,
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
    expect(other.fkojunstMailSync).toBeNull();
    expect(other.seibanMachineNameSupplementSync).toBeNull();
    expect(other.customerScawSync).toBeNull();
    expect(other.purchaseOrderLookupSync).toBeNull();
    expect(syncFromSupplementDashboard).not.toHaveBeenCalled();
    expect(syncFromFkojunstDashboard).not.toHaveBeenCalled();
    expect(syncFromStatusMailDashboard).not.toHaveBeenCalled();
    expect(syncFromSeibanMachineNameSupplementDashboard).not.toHaveBeenCalled();
    expect(syncFromCustomerScawDashboard).not.toHaveBeenCalled();
    expect(syncFromFkobainoDashboard).not.toHaveBeenCalled();

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
    expect(hit.fkojunstMailSync).toBeNull();
    expect(hit.seibanMachineNameSupplementSync).toBeNull();
    expect(hit.customerScawSync).toBeNull();
    expect(hit.purchaseOrderLookupSync).toBeNull();
    expect(syncFromSupplementDashboard).toHaveBeenCalledTimes(1);
    expect(syncFromFkojunstDashboard).not.toHaveBeenCalled();
    expect(syncFromStatusMailDashboard).not.toHaveBeenCalled();
    expect(syncFromSeibanMachineNameSupplementDashboard).not.toHaveBeenCalled();
    expect(syncFromCustomerScawDashboard).not.toHaveBeenCalled();
    expect(syncFromFkobainoDashboard).not.toHaveBeenCalled();
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
    expect(hit.fkojunstMailSync).toBeNull();
    expect(hit.seibanMachineNameSupplementSync).toBeNull();
    expect(hit.customerScawSync).toBeNull();
    expect(hit.purchaseOrderLookupSync).toBeNull();
    expect(syncFromFkojunstDashboard).toHaveBeenCalledTimes(1);
    expect(syncFromStatusMailDashboard).not.toHaveBeenCalled();
    expect(syncFromSupplementDashboard).not.toHaveBeenCalled();
    expect(syncFromSeibanMachineNameSupplementDashboard).not.toHaveBeenCalled();
    expect(syncFromCustomerScawDashboard).not.toHaveBeenCalled();
    expect(syncFromFkobainoDashboard).not.toHaveBeenCalled();
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
    expect(hit.fkojunstMailSync).toBeNull();
    expect(hit.customerScawSync).toBeNull();
    expect(hit.purchaseOrderLookupSync).toBeNull();
    expect(syncFromSeibanMachineNameSupplementDashboard).toHaveBeenCalledTimes(1);
    expect(syncFromSeibanMachineNameSupplementDashboard).toHaveBeenCalledWith({
      ingestRunId: 'run-seiban-machine-name',
    });
    expect(syncFromSupplementDashboard).not.toHaveBeenCalled();
    expect(syncFromFkojunstDashboard).not.toHaveBeenCalled();
    expect(syncFromStatusMailDashboard).not.toHaveBeenCalled();
    expect(syncFromCustomerScawDashboard).not.toHaveBeenCalled();
    expect(syncFromFkobainoDashboard).not.toHaveBeenCalled();
  });

  it('runs FKOJUNST_Status mail sync only for the FKOJUNST_Status mail dashboard id', async () => {
    const svc = new CsvDashboardPostIngestService();
    const hit = await svc.runAfterSuccessfulIngest({
      dashboardId: PRODUCTION_SCHEDULE_FKOJUNST_STATUS_MAIL_DASHBOARD_ID,
      ingestSource: 'gmail',
      ingestRunId: 'run-fkojunst-status-mail',
    });
    expect(hit.fkojunstMailSync).toEqual({
      scanned: 2,
      normalized: 2,
      matched: 2,
      unmatched: 0,
      skippedInvalidStatus: 0,
      skippedUnparseableDate: 0,
      upserted: 2,
      pruned: 0,
    });
    expect(hit.orderSupplementSync).toBeNull();
    expect(hit.fkojunstSync).toBeNull();
    expect(hit.seibanMachineNameSupplementSync).toBeNull();
    expect(hit.customerScawSync).toBeNull();
    expect(hit.purchaseOrderLookupSync).toBeNull();
    expect(syncFromStatusMailDashboard).toHaveBeenCalledTimes(1);
    expect(syncFromSupplementDashboard).not.toHaveBeenCalled();
    expect(syncFromFkojunstDashboard).not.toHaveBeenCalled();
    expect(syncFromSeibanMachineNameSupplementDashboard).not.toHaveBeenCalled();
    expect(syncFromCustomerScawDashboard).not.toHaveBeenCalled();
    expect(syncFromFkobainoDashboard).not.toHaveBeenCalled();
  });

  it('runs FKOBAINO purchase order lookup sync only for the FKOBAINO dashboard id', async () => {
    const svc = new CsvDashboardPostIngestService();
    const hit = await svc.runAfterSuccessfulIngest({
      dashboardId: PRODUCTION_SCHEDULE_FKOBAINO_DASHBOARD_ID,
      ingestSource: 'manual',
      ingestRunId: 'run-fkobaino',
    });
    expect(hit.purchaseOrderLookupSync).toEqual({
      scanned: 4,
      inserted: 4,
      upserted: 4,
    });
    expect(hit.orderSupplementSync).toBeNull();
    expect(hit.fkojunstSync).toBeNull();
    expect(hit.fkojunstMailSync).toBeNull();
    expect(hit.seibanMachineNameSupplementSync).toBeNull();
    expect(hit.customerScawSync).toBeNull();
    expect(syncFromFkobainoDashboard).toHaveBeenCalledTimes(1);
    expect(syncFromFkobainoDashboard).toHaveBeenCalledWith({
      ingestRunId: 'run-fkobaino',
    });
    expect(syncFromSupplementDashboard).not.toHaveBeenCalled();
    expect(syncFromFkojunstDashboard).not.toHaveBeenCalled();
    expect(syncFromStatusMailDashboard).not.toHaveBeenCalled();
    expect(syncFromSeibanMachineNameSupplementDashboard).not.toHaveBeenCalled();
    expect(syncFromCustomerScawDashboard).not.toHaveBeenCalled();
  });

  it('runs CustomerSCAW sync only for the CustomerSCAW dashboard id', async () => {
    const svc = new CsvDashboardPostIngestService();
    const hit = await svc.runAfterSuccessfulIngest({
      dashboardId: PRODUCTION_SCHEDULE_CUSTOMER_SCAW_DASHBOARD_ID,
      ingestSource: 'gmail',
      ingestRunId: 'run-customer-scaw',
    });
    expect(hit.customerScawSync).toEqual({
      csvRowsScanned: 2,
      fankenmeiKeys: 1,
      productionRowsScanned: 3,
      matchedFseibans: 1,
      upserted: 1,
      pruned: 0,
    });
    expect(hit.orderSupplementSync).toBeNull();
    expect(hit.fkojunstSync).toBeNull();
    expect(hit.fkojunstMailSync).toBeNull();
    expect(hit.seibanMachineNameSupplementSync).toBeNull();
    expect(hit.purchaseOrderLookupSync).toBeNull();
    expect(syncFromCustomerScawDashboard).toHaveBeenCalledTimes(1);
    expect(syncFromCustomerScawDashboard).toHaveBeenCalledWith({ ingestRunId: 'run-customer-scaw' });
    expect(syncFromSupplementDashboard).not.toHaveBeenCalled();
    expect(syncFromFkojunstDashboard).not.toHaveBeenCalled();
    expect(syncFromStatusMailDashboard).not.toHaveBeenCalled();
    expect(syncFromSeibanMachineNameSupplementDashboard).not.toHaveBeenCalled();
    expect(syncFromFkobainoDashboard).not.toHaveBeenCalled();
  });
});
