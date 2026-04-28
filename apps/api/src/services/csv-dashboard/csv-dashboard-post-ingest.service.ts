import { logger } from '../../lib/logger.js';
import {
  PRODUCTION_SCHEDULE_FKOBAINO_DASHBOARD_ID,
  PRODUCTION_SCHEDULE_FKOJUNST_DASHBOARD_ID,
  PRODUCTION_SCHEDULE_FKOJUNST_STATUS_MAIL_DASHBOARD_ID,
  PRODUCTION_SCHEDULE_ORDER_SUPPLEMENT_DASHBOARD_ID,
  PRODUCTION_SCHEDULE_SEIBAN_MACHINE_NAME_SUPPLEMENT_DASHBOARD_ID,
} from '../production-schedule/constants.js';
import { ProductionScheduleFkojunstSyncService } from '../production-schedule/fkojunst-sync.service.js';
import { ProductionScheduleFkojunstMailStatusSyncService } from '../production-schedule/fkojunst-status-mail-sync.service.js';
import { ProductionScheduleOrderSupplementSyncService } from '../production-schedule/order-supplement-sync.service.js';
import { ProductionScheduleSeibanMachineNameSupplementSyncService } from '../production-schedule/seiban-machine-name-supplement-sync.service.js';
import type { OrderSupplementSyncResult } from '../production-schedule/order-supplement-sync.pipeline.js';
import type { FkojunstSyncResult } from '../production-schedule/fkojunst-sync.pipeline.js';
import type { FkojunstMailSyncResult } from '../production-schedule/fkojunst-status-mail-sync.pipeline.js';
import type { SeibanMachineNameSupplementSyncResult } from '../production-schedule/seiban-machine-name-supplement-sync.pipeline.js';
import {
  PurchaseOrderLookupSyncService,
  type PurchaseOrderLookupSyncResult,
} from '../purchase-order-lookup/purchase-order-lookup-sync.service.js';

export type CsvDashboardIngestSource = 'gmail' | 'manual';

export type CsvDashboardPostIngestResult = {
  orderSupplementSync: OrderSupplementSyncResult | null;
  fkojunstSync: FkojunstSyncResult | null;
  fkojunstMailSync: FkojunstMailSyncResult | null;
  seibanMachineNameSupplementSync: SeibanMachineNameSupplementSyncResult | null;
  purchaseOrderLookupSync: PurchaseOrderLookupSyncResult | null;
};

/**
 * Runs CSV dashboard side-effects that must occur after a successful ingest,
 * for both Gmail and manual upload paths (single place to extend).
 */
export class CsvDashboardPostIngestService {
  constructor(
    private readonly orderSupplementSyncService: ProductionScheduleOrderSupplementSyncService = new ProductionScheduleOrderSupplementSyncService(),
    private readonly fkojunstSyncService: ProductionScheduleFkojunstSyncService = new ProductionScheduleFkojunstSyncService(),
    private readonly fkojunstMailStatusSyncService: ProductionScheduleFkojunstMailStatusSyncService = new ProductionScheduleFkojunstMailStatusSyncService(),
    private readonly seibanMachineNameSupplementSyncService: ProductionScheduleSeibanMachineNameSupplementSyncService = new ProductionScheduleSeibanMachineNameSupplementSyncService(),
    private readonly purchaseOrderLookupSyncService: PurchaseOrderLookupSyncService = new PurchaseOrderLookupSyncService()
  ) {}

  async runAfterSuccessfulIngest(params: {
    dashboardId: string;
    ingestSource: CsvDashboardIngestSource;
    ingestRunId?: string;
  }): Promise<CsvDashboardPostIngestResult> {
    let orderSupplementSync: OrderSupplementSyncResult | null = null;
    let fkojunstSync: FkojunstSyncResult | null = null;
    let fkojunstMailSync: FkojunstMailSyncResult | null = null;
    let seibanMachineNameSupplementSync: SeibanMachineNameSupplementSyncResult | null = null;
    let purchaseOrderLookupSync: PurchaseOrderLookupSyncResult | null = null;

    if (params.dashboardId === PRODUCTION_SCHEDULE_ORDER_SUPPLEMENT_DASHBOARD_ID) {
      orderSupplementSync = await this.orderSupplementSyncService.syncFromSupplementDashboard();
      logger.info(
        { dashboardId: params.dashboardId, ingestSource: params.ingestSource, syncResult: orderSupplementSync },
        '[CsvDashboardPostIngestService] Production schedule order supplement sync completed'
      );
    }

    if (params.dashboardId === PRODUCTION_SCHEDULE_FKOJUNST_DASHBOARD_ID) {
      fkojunstSync = await this.fkojunstSyncService.syncFromFkojunstDashboard();
      logger.info(
        { dashboardId: params.dashboardId, ingestSource: params.ingestSource, syncResult: fkojunstSync },
        '[CsvDashboardPostIngestService] FKOJUNST status sync completed'
      );
    }

    if (params.dashboardId === PRODUCTION_SCHEDULE_FKOJUNST_STATUS_MAIL_DASHBOARD_ID) {
      fkojunstMailSync = await this.fkojunstMailStatusSyncService.syncFromStatusMailDashboard();
      logger.info(
        { dashboardId: params.dashboardId, ingestSource: params.ingestSource, syncResult: fkojunstMailSync },
        '[CsvDashboardPostIngestService] FKOJUNST_Status mail sync completed'
      );
    }

    if (params.dashboardId === PRODUCTION_SCHEDULE_SEIBAN_MACHINE_NAME_SUPPLEMENT_DASHBOARD_ID) {
      if (!params.ingestRunId) {
        throw new Error('[CsvDashboardPostIngestService] ingestRunId is required for seiban machine name supplement sync');
      }
      seibanMachineNameSupplementSync = await this.seibanMachineNameSupplementSyncService.syncFromSupplementDashboard({
        ingestRunId: params.ingestRunId,
      });
      logger.info(
        {
          dashboardId: params.dashboardId,
          ingestSource: params.ingestSource,
          ingestRunId: params.ingestRunId,
          syncResult: seibanMachineNameSupplementSync,
        },
        '[CsvDashboardPostIngestService] Seiban machine name supplement sync completed'
      );
    }

    if (params.dashboardId === PRODUCTION_SCHEDULE_FKOBAINO_DASHBOARD_ID) {
      if (!params.ingestRunId) {
        throw new Error('[CsvDashboardPostIngestService] ingestRunId is required for FKOBAINO purchase order lookup sync');
      }
      purchaseOrderLookupSync = await this.purchaseOrderLookupSyncService.syncFromFkobainoDashboard({
        ingestRunId: params.ingestRunId,
      });
      logger.info(
        {
          dashboardId: params.dashboardId,
          ingestSource: params.ingestSource,
          ingestRunId: params.ingestRunId,
          syncResult: purchaseOrderLookupSync,
        },
        '[CsvDashboardPostIngestService] FKOBAINO purchase order lookup sync completed'
      );
    }

    if (
      orderSupplementSync === null &&
      fkojunstSync === null &&
      fkojunstMailSync === null &&
      seibanMachineNameSupplementSync === null &&
      purchaseOrderLookupSync === null
    ) {
      return {
        orderSupplementSync: null,
        fkojunstSync: null,
        fkojunstMailSync: null,
        seibanMachineNameSupplementSync: null,
        purchaseOrderLookupSync: null,
      };
    }

    return { orderSupplementSync, fkojunstSync, fkojunstMailSync, seibanMachineNameSupplementSync, purchaseOrderLookupSync };
  }
}
